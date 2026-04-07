import {
  lazy,
  Suspense,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { useGitPool } from "@/hooks/useGitPool";
import { useGitExplorer, type FileEntry } from "@/hooks/useGitExplorer";
import { RefSelector } from "@/components/RefSelector";
import { GitServerStatus } from "@/components/GitServerStatus";
import { RepoAboutPanel } from "@/components/RepoAboutPanel";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { GitGraspPool, PoolWarning, UrlState } from "@/lib/git-grasp-pool";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Folder,
  FileText,
  ChevronRight,
  GitCommit,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  Copy,
  Check,
  Eye,
  Code,
  Download,
} from "lucide-react";
import { getFileMediaType, toDataUri } from "@/lib/fileMediaType";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import {
  deriveEffectiveHeadCommit,
  deriveEffectiveSource,
} from "@/lib/sourceUtils";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));
import { CodeBlock } from "@/components/CodeBlock";
import { langFromFilename } from "@/lib/highlighter";

function isMarkdownFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepoCodePage() {
  const {
    cloneUrls,
    repoState,
    repoRelayEose,
    relayStateMap,
    treeRefAndPath,
    repoId,
    resolved,
  } = useRepoContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = resolved?.repo;

  // "source" query param drives which server's data the explorer shows.
  // No param = "default" (pool-decided). "nostr" or a clone URL are explicit.
  const selectedSource = searchParams.get("source") ?? "default";

  const handleSourceChange = useCallback(
    (src: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (src === "default") {
            next.delete("source");
          } else {
            next.set("source", src);
          }
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  // Single pool subscription — drives everything on this page.
  const { pool, poolState } = useGitPool(cloneUrls, {
    knownHeadCommit: repoState?.headCommitId,
    stateRefs: repoState?.refs,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  // Combined "pulling" signal: true while either Nostr relay EOSE is pending
  // or the git server fetch is in flight with stale data already shown.
  // Used for the locator bar's "Checking…" indicator.
  const pulling =
    cloneUrls.length > 0 ? !repoRelayEose || poolState.pulling : false;

  // Whether the git server check itself is still in flight (independent of
  // Nostr relay EOSE). Used for the warning banner and effectiveHeadCommit so
  // that a cached infoRefs result can surface the warning immediately without
  // waiting for the Nostr relay to send EOSE (which can take 2-5 s).
  const gitPulling = cloneUrls.length > 0 ? poolState.pulling : false;

  const stateBehindGit =
    !gitPulling && poolState.warning?.kind === "state-behind-git";

  // Run the explorer first with the Nostr/default commit so we get refs and
  // resolvedRef populated. We then derive the effective commit from the
  // selected source using the resolved ref, and re-run if it differs.
  //
  // Bootstrap pass: use the standard Nostr/default logic.
  const bootstrapHeadCommit = useMemo(() => {
    if (stateBehindGit) return undefined;
    return repoState?.headCommitId;
  }, [stateBehindGit, repoState?.headCommitId]);

  const explorer = useGitExplorer(pool, poolState, {
    refAndPath: treeRefAndPath,
    knownHeadCommit: bootstrapHeadCommit,
  });

  // Once the explorer has resolved the ref, derive the effective HEAD commit
  // from the selected source. This is what actually drives the displayed tree.
  const resolvedRef = explorer.resolvedRef;
  const resolvedRefIsBranch =
    explorer.refs.find((r) => r.name === resolvedRef)?.isBranch ?? true;

  // Resolve "default" → "nostr" or a concrete git server URL so all downstream
  // logic works with a real source value rather than re-deriving it everywhere.
  const isNoState = repoRelayEose && repoState === null;
  const effectiveSource = useMemo(
    () =>
      deriveEffectiveSource(
        selectedSource,
        stateBehindGit,
        isNoState,
        poolState.winnerUrl,
      ),
    [selectedSource, stateBehindGit, isNoState, poolState.winnerUrl],
  );

  const effectiveHeadCommit = useMemo(() => {
    return deriveEffectiveHeadCommit(
      effectiveSource,
      poolState.urls,
      repoState ?? null,
      stateBehindGit,
      resolvedRef,
      resolvedRefIsBranch,
    );
  }, [
    effectiveSource,
    poolState.urls,
    repoState,
    stateBehindGit,
    resolvedRef,
    resolvedRefIsBranch,
  ]);

  // Re-run the explorer with the effective commit when source changes.
  // We use a second explorer instance keyed on effectiveHeadCommit so that
  // the bootstrap explorer's cached state is not discarded on every render.
  const explorerForSource = useGitExplorer(pool, poolState, {
    refAndPath: treeRefAndPath,
    knownHeadCommit: effectiveHeadCommit,
  });

  // Use the source-aware explorer when the effective source is a git server
  // and its commit differs from the bootstrap; otherwise use the bootstrap
  // explorer (avoids a redundant fetch when source resolves to nostr).
  const useSourceExplorer =
    effectiveSource !== "nostr" && effectiveHeadCommit !== bootstrapHeadCommit;
  const activeExplorer = useSourceExplorer ? explorerForSource : explorer;

  // Page title: "<repo>/<path> at <ref> - ngit" or "<repo> - ngit" at root
  const seoTitle = useMemo(() => {
    const name = repo?.name ?? repoId;
    const ref = activeExplorer.resolvedRef;
    const path = activeExplorer.resolvedPath;
    if (ref && path) return `${name}/${path} at ${ref} - ngit`;
    if (ref) return `${name} at ${ref} - ngit`;
    return `${name} - ngit`;
  }, [
    repo?.name,
    repoId,
    activeExplorer.resolvedRef,
    activeExplorer.resolvedPath,
  ]);

  useSeoMeta({
    title: seoTitle,
    description:
      repo?.description ?? `Browse the source code of ${repo?.name ?? repoId}`,
  });

  // Build the base URL for this repo (without /tree/...)
  const basePath = useMemo(() => {
    const pathname = window.location.pathname;
    const treeIdx = pathname.indexOf("/tree");
    return treeIdx !== -1 ? pathname.slice(0, treeIdx) : pathname;
  }, []);

  // URL for a given ref + path. Branch names may contain "/" so we do NOT
  // encode them — the router receives the literal string and the explorer
  // resolves the ref via longest-prefix matching.
  const treeUrl = (ref: string, path?: string) => {
    const base = `${basePath}/tree/${ref}`;
    return path ? `${base}/${path}` : base;
  };

  // Handle branch/tag selector change
  const handleRefChange = (newRef: string) => {
    navigate(treeUrl(newRef));
  };

  const currentRef = activeExplorer.resolvedRef ?? "";
  const currentPath = activeExplorer.resolvedPath ?? "";
  const pathSegments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  // When the effective source is a git server (not nostr), the explorer may
  // still be showing the old signed commit during the render cycle where
  // stateBehindGit first becomes true (the explorer's useEffect hasn't fired
  // yet). Override with the git server's commit info so the commit bar,
  // warning banner, RefSelector, and tree viewer are always consistent.
  const effectiveSourceIsGitServer = effectiveSource !== "nostr";
  const displayHeadCommit =
    stateBehindGit && effectiveSourceIsGitServer
      ? (poolState.latestCommit ?? activeExplorer.headCommit)
      : activeExplorer.headCommit;
  const displayCommitHash =
    stateBehindGit && effectiveSourceIsGitServer
      ? poolState.warning?.kind === "state-behind-git"
        ? poolState.warning.gitCommitId
        : activeExplorer.commitHash
      : activeExplorer.commitHash;

  // Show the sidebar when at the repo root (no sub-path within the tree)
  const isAtRoot = !treeRefAndPath || pathSegments.length === 0;

  // Determine if we should show a README below the file tree
  const readmeEntry = activeExplorer.fileTree?.find(
    (f) => f.type === "file" && f.name.toLowerCase().startsWith("readme"),
  );

  const mainContent = (
    <div className="space-y-4">
      {/* No clone URLs */}
      {cloneUrls.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              This repository has no clone URLs configured.
            </p>
          </CardContent>
        </Card>
      )}

      {cloneUrls.length > 0 && (
        <>
          {/* Locator bar: branch selector + breadcrumb + commit info */}
          <LocatorBar
            loading={activeExplorer.loading}
            refs={activeExplorer.refs}
            currentRef={currentRef}
            pathSegments={pathSegments}
            basePath={basePath}
            treeUrl={treeUrl}
            onRefChange={handleRefChange}
            selectedSource={selectedSource}
            onSourceChange={handleSourceChange}
            headCommit={displayHeadCommit}
            commitHash={displayCommitHash}
            repoId={repoId}
            pulling={pulling}
            lastCheckedAt={poolState.lastCheckedAt}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            relayStateMap={relayStateMap}
            hasStateEvent={!!repoState}
            urlStates={poolState.urls}
            cloneUrls={cloneUrls}
            graspCloneUrls={repo?.graspCloneUrls ?? []}
            additionalGitServerUrls={repo?.additionalGitServerUrls ?? []}
            crossRefDiscrepancies={poolState.crossRefDiscrepancies}
            stateBehindGit={stateBehindGit}
            poolWarning={poolState.warning}
            pool={pool}
            winnerUrl={poolState.winnerUrl}
          />

          {/* State sync warning banner */}
          <GitServerAheadBanner
            warning={poolState.warning}
            pulling={gitPulling}
          />

          {/* Error state */}
          {activeExplorer.error && (
            <Card className="border-destructive/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{activeExplorer.error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Path not found */}
          {!activeExplorer.loading &&
            !activeExplorer.error &&
            !activeExplorer.pathExists && (
              <div className="text-center py-16 space-y-4">
                <h3 className="text-xl font-semibold">Path not found</h3>
                <p className="text-muted-foreground text-sm">
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                    {currentPath || "/"}
                  </code>{" "}
                  does not exist at ref{" "}
                  <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                    {currentRef}
                  </code>
                </p>
                <Button variant="outline" asChild>
                  <Link to={treeUrl(currentRef)}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to root
                  </Link>
                </Button>
              </div>
            )}

          {/* File tree (directory view) */}
          {(activeExplorer.loading ||
            (activeExplorer.fileTree && activeExplorer.isDirectory)) && (
            <FileTreeTable
              loading={activeExplorer.loading}
              entries={activeExplorer.fileTree}
              currentPath={currentPath}
              currentRef={currentRef}
              treeUrl={treeUrl}
            />
          )}

          {/* Parent directory listing + file content viewer (file view) */}
          {!activeExplorer.loading &&
            !activeExplorer.isDirectory &&
            activeExplorer.pathExists && (
              <>
                {activeExplorer.parentFileTree && (
                  <FileTreeTable
                    loading={false}
                    entries={activeExplorer.parentFileTree}
                    currentPath={pathSegments.slice(0, -1).join("/")}
                    currentRef={currentRef}
                    treeUrl={treeUrl}
                    activeFile={pathSegments[pathSegments.length - 1]}
                  />
                )}
                <FileContentViewer
                  filename={pathSegments[pathSegments.length - 1] ?? ""}
                  filePath={activeExplorer.resolvedPath ?? ""}
                  content={activeExplorer.fileContent}
                  fileBytes={activeExplorer.fileBytes}
                  cloneUrls={cloneUrls}
                  commitHash={activeExplorer.commitHash}
                />
              </>
            )}

          {/* README below file tree */}
          {!activeExplorer.loading &&
            activeExplorer.isDirectory &&
            readmeEntry &&
            activeExplorer.commitHash &&
            pool && (
              <ReadmeViewer
                pool={pool}
                commitHash={activeExplorer.commitHash}
                readmePath={readmeEntry.path}
                readmeName={readmeEntry.name}
                cloneUrls={cloneUrls}
              />
            )}
        </>
      )}
    </div>
  );

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {isAtRoot && repo ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
          {mainContent}
          <RepoSidebar repo={repo} />
        </div>
      ) : (
        mainContent
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git server ahead banner
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a URL string, falling back to the raw URL.
 */
function gitServerDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Banner shown when one or more git servers have commits newer than the
 * Nostr-announced state. Tells the user which server is ahead and how stale
 * the Nostr state is, so they understand why the code view may differ from
 * what the maintainer last announced on Nostr.
 */
function GitServerAheadBanner({
  warning,
  pulling,
}: {
  warning: PoolWarning | null;
  pulling: boolean;
}) {
  // Suppress while data is still loading — the mismatch may resolve once
  // infoRefs settle.
  if (!warning || pulling) return null;

  if (warning.kind === "state-behind-git") {
    const stateAge = safeFormatDistanceToNow(warning.stateCreatedAt, {
      addSuffix: true,
    });
    const gitAge = safeFormatDistanceToNow(warning.gitCommitterDate, {
      addSuffix: true,
    });
    const shortState = warning.stateCommitId.slice(0, 8);
    const shortGit = warning.gitCommitId.slice(0, 8);

    // Use the domain of the specific server that reported the newer commit.
    const domain = gitServerDomain(warning.gitServerUrl);

    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5 min-w-0">
          <p className="font-medium">
            {domain} has commits not yet announced on Nostr
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70 leading-relaxed">
            Showing the git server&apos;s latest commit{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">
              {shortGit}
            </code>{" "}
            ({gitAge}) — ahead of the last Nostr-announced commit{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">
              {shortState}
            </code>{" "}
            ({stateAge}).
          </p>
        </div>
      </div>
    );
  }

  if (warning.kind === "state-commit-unavailable") {
    const shortState = warning.stateCommitId.slice(0, 8);
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">
            Nostr-announced commit not found on git server
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            The maintainer announced commit{" "}
            <code className="font-mono bg-amber-500/10 px-1 rounded">
              {shortState}
            </code>{" "}
            as HEAD on Nostr, but it couldn&apos;t be found on any git server.
            Showing the latest available commit instead.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Locator bar
// ---------------------------------------------------------------------------

function LocatorBar({
  loading,
  refs,
  currentRef,
  pathSegments,
  basePath,
  treeUrl,
  onRefChange,
  selectedSource,
  onSourceChange,
  headCommit,
  commitHash,
  repoId,
  pulling,
  lastCheckedAt,
  repoState,
  repoRelayEose,
  relayStateMap,
  hasStateEvent,
  urlStates,
  cloneUrls,
  graspCloneUrls,
  additionalGitServerUrls,
  crossRefDiscrepancies,
  stateBehindGit,
  poolWarning,
  pool,
  winnerUrl,
}: {
  loading: boolean;
  refs: ReturnType<typeof useGitExplorer>["refs"];
  currentRef: string;
  pathSegments: string[];
  basePath: string;
  treeUrl: (ref: string, path?: string) => string;
  onRefChange: (ref: string) => void;
  selectedSource: string;
  onSourceChange: (src: string) => void;
  headCommit: ReturnType<typeof useGitExplorer>["headCommit"];
  commitHash: string | null;
  repoId: string;
  pulling: boolean;
  lastCheckedAt: number | null;
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  relayStateMap: Map<string, import("nostr-tools").NostrEvent>;
  hasStateEvent: boolean;
  urlStates: Record<string, UrlState>;
  cloneUrls: string[];
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  crossRefDiscrepancies: import("@/lib/git-grasp-pool").RefDiscrepancy[];
  stateBehindGit: boolean;
  poolWarning: PoolWarning | null;
  pool: import("@/lib/git-grasp-pool").GitGraspPool | null;
  winnerUrl: string | null;
}) {
  // Hide "checked" text if showing it would cause the bar to wrap onto
  // multiple lines. We directly manipulate the DOM via refs to avoid a
  // render cycle — measure height without it, then with it, and show/hide
  // accordingly.
  const barRef = useRef<HTMLDivElement>(null);
  const checkedRef = useRef<HTMLSpanElement>(null);

  const hasRepoState = !!repoState;

  // Compute the full ref name for the pool's refStatus lookup
  const currentRefObj = refs.find((r) => r.name === currentRef);
  const currentRefFull = currentRefObj
    ? currentRefObj.isBranch
      ? `refs/heads/${currentRef}`
      : `refs/tags/${currentRef}`
    : "";
  const pathKey = pathSegments.join("/");

  useEffect(() => {
    const bar = barRef.current;
    const checked = checkedRef.current;
    if (!bar || !checked) return;
    const check = () => {
      // Measure without
      checked.style.display = "none";
      const heightWithout = bar.scrollHeight;
      // Measure with
      checked.style.display = "";
      const heightWith = bar.scrollHeight;
      // Hide if it causes wrapping
      checked.style.display = heightWith <= heightWithout ? "" : "none";
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [lastCheckedAt, pulling, hasRepoState, pathKey, currentRef, refs.length]);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      {/* Top bar: branch selector + breadcrumb + pulling status */}
      <div
        ref={barRef}
        className={cn(
          "flex items-center gap-2 px-3 py-2 flex-wrap relative",
          pulling ? "fetching-gradient" : "bg-muted/30",
        )}
      >
        {/* Branch/tag selector */}
        {refs.length > 0 ? (
          <RefSelector
            refs={refs}
            currentRef={currentRef}
            onRefChange={onRefChange}
            selectedSource={selectedSource}
            onSourceChange={onSourceChange}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            relayStateMap={relayStateMap}
            loading={loading}
            stateBehindGit={stateBehindGit}
            poolWarning={poolWarning}
            winnerUrl={winnerUrl}
            stateCreatedAt={repoState?.event.created_at}
            urlStates={urlStates}
            cloneUrls={cloneUrls}
            graspCloneUrls={graspCloneUrls}
            additionalGitServerUrls={additionalGitServerUrls}
            pool={pool}
          />
        ) : loading ? (
          <Skeleton className="h-8 w-28" />
        ) : null}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm min-w-0 flex-1 flex-wrap">
          <Link
            to={treeUrl(currentRef)}
            className="text-pink-600 dark:text-pink-400 hover:underline font-medium shrink-0"
          >
            {repoId}
          </Link>
          {pathSegments.map((seg, i) => {
            const segPath = pathSegments.slice(0, i + 1).join("/");
            const isLast = i === pathSegments.length - 1;
            return (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {isLast ? (
                  <span className="font-medium">{seg}</span>
                ) : (
                  <Link
                    to={treeUrl(currentRef, segPath)}
                    className="text-pink-600 dark:text-pink-400 hover:underline"
                  >
                    {seg}
                  </Link>
                )}
              </span>
            );
          })}
        </div>

        {/* Right side: pulling indicator + server status */}
        {pulling ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking…
          </span>
        ) : repoState ? (
          // We have a live Nostr state event subscription — always "just now"
          // because we're still listening for updates via that subscription.
          <span
            ref={checkedRef}
            className="text-xs text-muted-foreground/60 shrink-0 whitespace-nowrap"
          >
            checked just now
          </span>
        ) : lastCheckedAt ? (
          <span
            ref={checkedRef}
            className="text-xs text-muted-foreground/60 shrink-0 whitespace-nowrap"
          >
            checked{" "}
            {safeFormatDistanceToNow(lastCheckedAt, { addSuffix: true })}
          </span>
        ) : null}

        {/* Git server status indicator — right-most element */}
        {cloneUrls.length > 0 && (
          <GitServerStatus
            currentRefFull={currentRefFull}
            currentRefShort={currentRef}
            repoRelayEose={repoRelayEose}
            hasStateEvent={hasStateEvent}
            urlStates={urlStates}
            cloneUrls={cloneUrls}
            graspCloneUrls={graspCloneUrls}
            additionalGitServerUrls={additionalGitServerUrls}
            crossRefDiscrepancies={crossRefDiscrepancies}
            poolWarning={poolWarning}
            stateCreatedAt={repoState?.event.created_at}
            pool={pool}
          />
        )}
      </div>

      {/* Commit summary row */}
      {headCommit ? (
        <Link
          to={`${basePath}/commit/${commitHash}`}
          className="flex items-center gap-3 px-3 py-2.5 bg-background hover:bg-muted/20 transition-colors border-t border-border/40"
        >
          <div className="p-1.5 rounded-full bg-muted shrink-0">
            <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate leading-snug">
              {headCommit.message.split("\n")[0]}
            </p>
            <p className="text-xs text-muted-foreground">
              {headCommit.author.name} &middot;{" "}
              {safeFormatDistanceToNow(
                headCommit.committer?.timestamp ?? headCommit.author.timestamp,
                { addSuffix: true },
              )}
            </p>
          </div>
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
            {commitHash?.slice(0, 8)}
          </code>
        </Link>
      ) : loading || commitHash ? (
        <div className="flex items-center gap-3 px-3 py-2.5 border-t border-border/40">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File tree table
// ---------------------------------------------------------------------------

function FileTreeTable({
  loading,
  entries,
  currentPath,
  currentRef,
  treeUrl,
  activeFile,
}: {
  loading: boolean;
  entries: FileEntry[] | null;
  currentPath: string;
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
  activeFile?: string;
}) {
  const parentPath = currentPath
    ? currentPath.split("/").slice(0, -1).join("/")
    : null;

  if (loading && !entries) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border/40">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-48" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!entries) return null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="divide-y divide-border/40">
          {/* Parent directory link */}
          {parentPath !== null && (
            <Link
              to={treeUrl(currentRef, parentPath || undefined)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-sm text-muted-foreground"
            >
              <Folder className="h-4 w-4 text-blue-500/70 shrink-0" />
              <span>..</span>
            </Link>
          )}

          {entries.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Empty directory
            </div>
          )}

          {entries.map((entry) => (
            <FileTreeRow
              key={entry.path}
              entry={entry}
              currentRef={currentRef}
              treeUrl={treeUrl}
              isActive={activeFile === entry.name && entry.type === "file"}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FileTreeRow({
  entry,
  currentRef,
  treeUrl,
  isActive,
}: {
  entry: FileEntry;
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
  isActive?: boolean;
}) {
  const isDir = entry.type === "directory";
  const isReadme = entry.name.toLowerCase().startsWith("readme");

  return (
    <Link
      to={treeUrl(currentRef, entry.path)}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group",
        isActive && "bg-muted/50",
      )}
    >
      {isDir ? (
        <Folder className="h-4 w-4 text-blue-500 shrink-0" />
      ) : (
        <FileText
          className={cn(
            "h-4 w-4 shrink-0",
            isActive ? "text-pink-500" : "text-muted-foreground",
          )}
        />
      )}
      <span
        className={cn(
          "text-sm flex-1 truncate",
          isDir
            ? "text-foreground font-medium"
            : isActive
              ? "text-foreground font-medium"
              : "text-foreground/90",
        )}
      >
        {entry.name}
      </span>
      {isReadme && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
          README
        </Badge>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Repo sidebar (shown at root alongside file tree, GitHub-style)
// ---------------------------------------------------------------------------

import type { ResolvedRepo } from "@/lib/nip34";
function RepoSidebar({ repo }: { repo: ResolvedRepo }) {
  return <RepoAboutPanel repo={repo} variant="sidebar" />;
}

// ---------------------------------------------------------------------------
// File content viewer
// ---------------------------------------------------------------------------

type ViewMode = "rendered" | "text";

function FileContentViewer({
  filename,
  filePath,
  content,
  fileBytes,
  cloneUrls,
  commitHash,
}: {
  filename: string;
  filePath: string;
  content: string | null;
  fileBytes: Uint8Array | null;
  cloneUrls: string[];
  commitHash: string | null;
}) {
  const mediaType = getFileMediaType(filename);
  const isBinaryMedia =
    mediaType?.kind === "image" ||
    mediaType?.kind === "video" ||
    mediaType?.kind === "audio" ||
    mediaType?.kind === "svg";

  // Default view mode: rendered for markdown/svg/images, text for everything else
  const defaultMode: ViewMode =
    mediaType?.kind === "markdown" ||
    mediaType?.kind === "svg" ||
    mediaType?.kind === "image" ||
    mediaType?.kind === "video" ||
    mediaType?.kind === "audio"
      ? "rendered"
      : "text";

  const [viewMode, setViewMode] = useState<ViewMode>(defaultMode);

  // Reset view mode when the file changes
  useEffect(() => {
    setViewMode(defaultMode);
  }, [filename]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = useCallback(() => {
    if (!fileBytes) return;
    const mime =
      mediaType && "mime" in mediaType
        ? mediaType.mime
        : mediaType?.kind === "svg"
          ? "image/svg+xml"
          : "application/octet-stream";
    const blob = new Blob([fileBytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileBytes, filename, mediaType]);

  const [copiedText, setCopiedText] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);

  // Copy text content to clipboard (text/code/markdown/SVG source)
  const handleCopyText = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    });
  }, [content]);

  // Copy image to clipboard as PNG via canvas (raster images and SVG)
  const handleCopyImage = useCallback(() => {
    if (!fileBytes) return;
    const isRaster = mediaType?.kind === "image";
    const isSvg = mediaType?.kind === "svg";
    if (!isRaster && !isSvg) return;
    const mime = isRaster ? mediaType.mime : "image/svg+xml";
    const blob = new Blob([fileBytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        navigator.clipboard
          .write([new ClipboardItem({ "image/png": pngBlob })])
          .then(() => {
            setCopiedImage(true);
            setTimeout(() => setCopiedImage(false), 2000);
          })
          .catch(() => {
            // Clipboard write failed (e.g. permissions denied) — silently ignore
          });
      }, "image/png");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [fileBytes, mediaType]);

  // Loading state
  if (!isBinaryMedia && content === null) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading file content…
          </div>
        </CardContent>
      </Card>
    );
  }
  if (isBinaryMedia && fileBytes === null) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading file content…
          </div>
        </CardContent>
      </Card>
    );
  }

  const lang = langFromFilename(filename);
  const canToggle = mediaType?.kind === "markdown" || mediaType?.kind === "svg";

  return (
    <Card>
      <CardHeader className="py-2.5 px-4 border-b border-border/40 bg-muted/80 backdrop-blur-sm sticky top-14 z-10 rounded-t-lg">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate min-w-0">
            {filename}
          </span>

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {/* View mode toggle — only for renderable text types */}
            {canToggle && (
              <>
                <button
                  onClick={() => setViewMode("rendered")}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                    viewMode === "rendered"
                      ? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
                <button
                  onClick={() => setViewMode("text")}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                    viewMode === "text"
                      ? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Code className="h-3 w-3" />
                  Source
                </button>
              </>
            )}

            {/* Line count + language badge for non-binary, non-toggle files */}
            {!canToggle && !isBinaryMedia && content !== null && (
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {content.split("\n").length} lines
              </span>
            )}
            {!canToggle && !isBinaryMedia && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                {lang}
              </Badge>
            )}

            {/* Copy SVG as text — copy icon with "text" label to distinguish from copy-as-PNG */}
            {mediaType?.kind === "svg" && content !== null && (
              <button
                onClick={handleCopyText}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Copy as text"
              >
                {copiedText ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span className="text-[10px] font-semibold leading-none">
                  TEXT
                </span>
              </button>
            )}

            {/* Copy as PNG — label only shown for SVG where both copy buttons coexist */}
            {(mediaType?.kind === "image" || mediaType?.kind === "svg") &&
              fileBytes && (
                <button
                  onClick={handleCopyImage}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy as PNG"
                >
                  {copiedImage ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {mediaType?.kind === "svg" && (
                    <span className="text-[10px] font-semibold leading-none">
                      PNG
                    </span>
                  )}
                </button>
              )}

            {/* Copy text — text/code/markdown (not binary media) */}
            {!isBinaryMedia && content !== null && (
              <button
                onClick={handleCopyText}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Copy file content"
              >
                {copiedText ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            )}

            {/* Download — all file types */}
            {fileBytes && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Download file"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 overflow-hidden rounded-b-lg">
        <FileContentBody
          filename={filename}
          filePath={filePath}
          content={content}
          fileBytes={fileBytes}
          mediaType={mediaType}
          viewMode={viewMode}
          cloneUrls={cloneUrls}
          commitHash={commitHash}
        />
      </CardContent>
    </Card>
  );
}

function FileContentBody({
  filename,
  filePath,
  content,
  fileBytes,
  mediaType,
  viewMode,
  cloneUrls,
  commitHash,
}: {
  filename: string;
  filePath: string;
  content: string | null;
  fileBytes: Uint8Array | null;
  mediaType: ReturnType<typeof getFileMediaType>;
  viewMode: ViewMode;
  cloneUrls: string[];
  commitHash: string | null;
}) {
  // Image (raster)
  if (mediaType?.kind === "image" && fileBytes) {
    return (
      <div className="p-6 flex justify-center items-center bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
        <img
          src={toDataUri(fileBytes, mediaType.mime)}
          alt={filename}
          className="max-w-full h-auto rounded-md shadow-sm"
        />
      </div>
    );
  }

  // SVG — rendered or source
  if (mediaType?.kind === "svg" && fileBytes) {
    if (viewMode === "rendered") {
      const svgMime = "image/svg+xml";
      return (
        <div className="p-6 flex justify-center items-center bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
          <img
            src={toDataUri(fileBytes, svgMime)}
            alt={filename}
            className="max-w-full h-auto rounded-md shadow-sm min-w-[120px]"
          />
        </div>
      );
    }
    // Fall through to text view
  }

  // Video
  if (mediaType?.kind === "video" && fileBytes) {
    return (
      <div className="p-6 flex justify-center">
        <video
          controls
          className="max-w-full rounded-md shadow-sm"
          style={{ maxHeight: "480px" }}
        >
          <source
            src={toDataUri(fileBytes, mediaType.mime)}
            type={mediaType.mime}
          />
          Your browser does not support the video tag.
        </video>
      </div>
    );
  }

  // Audio
  if (mediaType?.kind === "audio" && fileBytes) {
    return (
      <div className="p-6 flex justify-center">
        <audio controls className="w-full max-w-md">
          <source
            src={toDataUri(fileBytes, mediaType.mime)}
            type={mediaType.mime}
          />
          Your browser does not support the audio tag.
        </audio>
      </div>
    );
  }

  // Markdown — rendered or source
  if (mediaType?.kind === "markdown" && content !== null) {
    if (viewMode === "rendered") {
      return (
        <div className="p-6">
          <Suspense
            fallback={
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            }
          >
            <MarkdownContent
              content={content}
              cloneUrls={cloneUrls}
              commitHash={commitHash}
              filePath={filePath}
            />
          </Suspense>
        </div>
      );
    }
    // Fall through to text/source view
  }

  // Plain text / source view — syntax highlighted with line numbers
  if (content !== null) {
    return <CodeBlock code={content} filename={filename} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// README viewer — receives the pool directly, no getOrCreatePool call
// ---------------------------------------------------------------------------

import { BookOpen } from "lucide-react";

function ReadmeViewer({
  pool,
  commitHash,
  readmePath,
  readmeName,
  cloneUrls,
}: {
  pool: GitGraspPool;
  commitHash: string;
  readmePath: string;
  readmeName: string;
  cloneUrls: string[];
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!commitHash) return;

    // Check text cache first (synchronous, no loading flash on remount).
    const cachedText = pool.cache.getText(commitHash, readmeName);
    if (cachedText !== undefined) {
      setContent(cachedText);
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setContent(null);

    pool
      .getObjectByPath(commitHash, readmePath, abort.signal)
      .then(async (result) => {
        if (abort.signal.aborted) return;
        if (!result || result.isDir || !result.data) {
          setLoading(false);
          return;
        }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          result.data,
        );
        pool.cache.putText(commitHash, readmeName, text);
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [pool, commitHash, readmePath, readmeName]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="py-2.5 px-4 border-b border-border/40 bg-muted/20">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <Skeleton className="h-4 w-24" />
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </CardContent>
      </Card>
    );
  }

  if (!content) return null;

  const isMarkdown = isMarkdownFile(readmeName);

  return (
    <Card>
      <CardHeader className="py-2.5 px-4 border-b border-border/40 bg-muted/20">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{readmeName}</span>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {isMarkdown ? (
          <Suspense
            fallback={
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            }
          >
            <MarkdownContent
              content={content}
              cloneUrls={cloneUrls}
              commitHash={commitHash}
              filePath={readmePath}
            />
          </Suspense>
        ) : (
          <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed">
            {content}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
