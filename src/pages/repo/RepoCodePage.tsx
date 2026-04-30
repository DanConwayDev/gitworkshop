import {
  lazy,
  Suspense,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { useRepoContext } from "./RepoContext";
import { useProfile } from "@/hooks/useProfile";
import { useGitPool } from "@/hooks/useGitPool";
import {
  useGitExplorer,
  useFullFileTree,
  type FileEntry,
  type FlatFileEntry,
  type FullFileTreeState,
} from "@/hooks/useGitExplorer";
import { RefSelector } from "@/components/RefSelector";
import { GitServerStatus } from "@/components/GitServerStatus";
import { RepoAboutPanel } from "@/components/RepoAboutPanel";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { GitGraspPool, PoolWarning, UrlState } from "@/lib/git-grasp-pool";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  History,
  Search,
} from "lucide-react";
import { getFileMediaType, toDataUri } from "@/lib/fileMediaType";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import {
  deriveEffectiveHeadCommit,
  deriveEffectiveSource,
} from "@/lib/sourceUtils";
import { isNonHttpUrl } from "@/lib/git-grasp-pool";
import { IncompatibleProtocolError } from "@/components/IncompatibleProtocolError";

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
    pubkey,
  } = useRepoContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = resolved?.repo;

  // Detect incompatible protocol early — before the pool is even created, so
  // we can skip all loading states and show a helpful message immediately.
  const allUrlsIncompatible =
    cloneUrls.length > 0 && cloneUrls.every(isNonHttpUrl);

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
  // When the user explicitly chose "nostr" as source, honour the Nostr commit
  // even when stateBehindGit is true — the user wants to see the signed state.
  const userChoseNostr = selectedSource === "nostr";
  const bootstrapHeadCommit = useMemo(() => {
    if (stateBehindGit && !userChoseNostr) return undefined;
    return repoState?.headCommitId;
  }, [stateBehindGit, userChoseNostr, repoState?.headCommitId]);

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
  const aheadServerUrl =
    poolState.warning?.kind === "state-behind-git"
      ? poolState.warning.gitServerUrl
      : null;
  const effectiveSource = useMemo(
    () =>
      deriveEffectiveSource(
        selectedSource,
        stateBehindGit,
        isNoState,
        poolState.winnerUrl,
        aheadServerUrl,
      ),
    [
      selectedSource,
      stateBehindGit,
      isNoState,
      poolState.winnerUrl,
      aheadServerUrl,
    ],
  );

  const effectiveHeadCommit = useMemo(() => {
    return deriveEffectiveHeadCommit(
      effectiveSource,
      poolState.urls,
      repoState ?? null,
      // When the user explicitly chose "nostr", treat stateBehindGit as false
      // so the explorer uses the Nostr state commit rather than the git server's.
      stateBehindGit && selectedSource !== "nostr",
      resolvedRef,
      resolvedRefIsBranch,
    );
  }, [
    effectiveSource,
    poolState.urls,
    repoState,
    stateBehindGit,
    selectedSource,
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

  // Full file tree for go-to-file search. Uses the same commitHash the active
  // explorer is displaying so the search results stay consistent with the view.
  const fullFileTree = useFullFileTree(pool, activeExplorer.commitHash);

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

  const repoOwnerProfile = useProfile(pubkey);

  useSeoMeta({
    title: seoTitle,
    description:
      repo?.description ?? `Browse the source code of ${repo?.name ?? repoId}`,
    ogImage: repoOwnerProfile?.picture ?? "/og-image.svg",
    ogImageAlt: repo?.name ?? repoId,
    twitterCard: repoOwnerProfile?.picture ? "summary" : "summary_large_image",
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

  // Handle branch/tag selector change — preserve the source query param so
  // switching branches doesn't silently revert to the default source.
  const handleRefChange = useCallback(
    (newRef: string) => {
      const source = searchParams.get("source");
      const base = `${basePath}/tree/${newRef}`;
      if (source) {
        navigate(`${base}?source=${encodeURIComponent(source)}`);
      } else {
        navigate(base);
      }
    },
    [navigate, searchParams, basePath],
  );

  // Atomic handler: navigate to a new ref while simultaneously applying a
  // source change. Used when the user picks a source that doesn't have the
  // current ref — we need both changes in one navigation so neither is lost.
  const handleRefAndSourceChange = useCallback(
    (newRef: string, newSource: string) => {
      const params = new URLSearchParams(searchParams);
      if (newSource === "default") {
        params.delete("source");
      } else {
        params.set("source", newSource);
      }
      const query = params.toString();
      const url = `${basePath}/tree/${newRef}${query ? `?${query}` : ""}`;
      navigate(url);
    },
    [navigate, searchParams, basePath],
  );

  const currentRef = activeExplorer.resolvedRef ?? "";
  const currentPath = activeExplorer.resolvedPath ?? "";
  const pathSegments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  // Full ref name for the currently selected ref — used by the banner and
  // the git server status icon to look up per-ref status from the pool.
  const currentRefObj = activeExplorer.refs.find((r) => r.name === currentRef);
  const currentRefFull = currentRefObj
    ? currentRefObj.isBranch
      ? `refs/heads/${currentRef}`
      : `refs/tags/${currentRef}`
    : "";

  // The commit bar and warning banner must always show the same commit — the
  // one the explorer is actually displaying. Use the explorer's own commitHash
  // and headCommit directly; the warning banner independently references
  // poolState.warning for its comparison text (stateCommitId vs gitCommitId).
  const displayCommitHash = activeExplorer.commitHash;
  const displayHeadCommit = activeExplorer.headCommit;

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

      {/* All clone URLs use incompatible protocols (SSH, git://, etc.) */}
      {allUrlsIncompatible && (
        <IncompatibleProtocolError
          cloneUrls={cloneUrls}
          pubkey={pubkey}
          repoId={repoId}
        />
      )}

      {cloneUrls.length > 0 && !allUrlsIncompatible && (
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
            onRefAndSourceChange={handleRefAndSourceChange}
            headCommit={displayHeadCommit}
            commitHash={displayCommitHash}
            repoId={repoId}
            pulling={pulling}
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
            fullFileTree={fullFileTree}
          />

          {/* State sync warning banner — hidden when user explicitly chose nostr */}
          {!userChoseNostr && (
            <GitServerAheadBanner
              warning={poolState.warning}
              pulling={gitPulling}
              currentRefFull={currentRefFull}
              urlStates={poolState.urls}
              repoStateRefs={repoState?.refs}
              hasStateEvent={!!repoState}
              repoRelayEose={repoRelayEose}
              displayedCommitHash={displayCommitHash}
              effectiveSource={effectiveSource}
            />
          )}

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
 *
 * The banner is suppressed when the currently selected ref is in sync across
 * all servers — i.e. no server has a "behind" refStatus for that ref.
 *
 * When the selected ref is not present in the Nostr state at all (but a state
 * event exists), a softer informational variant is shown instead.
 */
function GitServerAheadBanner({
  warning,
  pulling,
  currentRefFull,
  urlStates,
  repoStateRefs,
  hasStateEvent,
  repoRelayEose,
  displayedCommitHash,
  effectiveSource,
}: {
  warning: PoolWarning | null;
  pulling: boolean;
  /** Full ref name for the currently selected ref (e.g. "refs/heads/main") */
  currentRefFull: string;
  /** Per-URL state from the pool — used to check per-ref sync status */
  urlStates: Record<string, UrlState>;
  /** Refs declared in the Nostr state event, if any */
  repoStateRefs: Array<{ name: string }> | undefined;
  /** Whether a Nostr state event exists for this repo */
  hasStateEvent: boolean;
  /** True once the relay EOSE has been received */
  repoRelayEose: boolean;
  /** The commit hash the explorer is actually displaying — used in the banner text */
  displayedCommitHash: string | null;
  /** The resolved source being displayed — "nostr" or a concrete clone URL */
  effectiveSource: string;
}) {
  // Suppress while data is still loading — the mismatch may resolve once
  // infoRefs settle.
  if (pulling) return null;

  // Only show anything once we know whether a state event exists.
  if (!repoRelayEose) return null;

  // No Nostr state at all — nothing to compare against, stay silent.
  if (!hasStateEvent) return null;

  // If there is a state event but the selected ref is not in it, show a
  // softer informational banner (the maintainer hasn't announced this ref).
  if (currentRefFull && repoStateRefs) {
    const refInState = repoStateRefs.some((r) => r.name === currentRefFull);
    if (!refInState) {
      return (
        <div className="flex items-start gap-3 rounded-lg border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium text-foreground/80">
              This ref isn&apos;t tracked on Nostr
            </p>
            <p className="text-xs leading-relaxed">
              The maintainer&apos;s last Nostr announcement does not include{" "}
              <code className="font-mono bg-muted px-1 rounded">
                {currentRefFull
                  .replace("refs/heads/", "")
                  .replace("refs/tags/", "")}
              </code>
              . Showing the git server&apos;s version of this ref.
            </p>
          </div>
        </div>
      );
    }
  }

  // No pool warning — nothing further to show.
  if (!warning) return null;

  // Only show the banner when the *currently displayed* server is the one
  // that's ahead of Nostr. If the user selected a server that matches the
  // Nostr state, the banner is irrelevant regardless of what other servers do.
  if (warning.kind === "state-behind-git" && currentRefFull) {
    const sourceUrlState = urlStates[effectiveSource];
    const sourceRefStatus = sourceUrlState?.refStatus[currentRefFull];
    // "behind" in pool semantics = this server has a *different* commit than
    // the Nostr state. In the state-behind-git scenario that means it's ahead.
    // Any other status (match, connected, unknown, error) means this server
    // is not the one driving the "ahead" situation — suppress the banner.
    if (sourceRefStatus !== "behind") return null;
  }

  if (warning.kind === "state-behind-git") {
    const stateAge = safeFormatDistanceToNow(warning.stateCreatedAt, {
      addSuffix: true,
    });
    const gitAge = safeFormatDistanceToNow(warning.gitCommitterDate, {
      addSuffix: true,
    });
    const shortState = warning.stateCommitId.slice(0, 8);
    // Use the explorer's actual displayed commit hash so the banner is always
    // consistent with the commit bar. Fall back to the pool's warning commit
    // (HEAD of the git server) while the explorer is still loading.
    const shortGit = (displayedCommitHash ?? warning.gitCommitId).slice(0, 8);

    // Use the domain of the effective source (the server being viewed),
    // not necessarily the server that first triggered the warning.
    const domain = gitServerDomain(effectiveSource);

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
// Collapsible path breadcrumb
// ---------------------------------------------------------------------------

// Approximate px width of a single character at 14px (0.875rem) font size.
const CHAR_PX = 7.5;
// Fixed overhead per segment: chevron (14px) + gap (4px) + gap (4px) = ~22px
const SEG_OVERHEAD_PX = 22;
// Width of the "…" button
const ELLIPSIS_PX = 28;

function estimateTextPx(text: string) {
  return text.length * CHAR_PX;
}

function CollapsibleBreadcrumb({
  repoId,
  pathSegments,
  currentRef,
  treeUrl,
  searchCompact,
  onTruncatedChange,
}: {
  repoId: string;
  pathSegments: string[];
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
  searchCompact: boolean;
  onTruncatedChange?: (truncated: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  // When the user explicitly expands, show everything regardless of width.
  const [forceExpanded, setForceExpanded] = useState(false);

  // Reset forceExpanded when the path changes — tracked as a ref so we can
  // derive the reset inline without a separate effect causing an extra render.
  const pathKey = pathSegments.join("/");
  const prevPathKeyRef = useRef(pathKey);
  if (prevPathKeyRef.current !== pathKey) {
    prevPathKeyRef.current = pathKey;
    if (forceExpanded) setForceExpanded(false);
  }

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Compute how many middle segments (between root and last) we can show.
  // Always show: root + last. Middle segments are indices 0..n-2 of pathSegments.
  const lastSegment = pathSegments[pathSegments.length - 1] ?? "";
  const middleSegments = pathSegments.slice(0, -1);

  // Budget: total width minus root, last segment, their separators.
  const rootPx = estimateTextPx(repoId) + SEG_OVERHEAD_PX;
  const lastPx =
    pathSegments.length > 0 ? estimateTextPx(lastSegment) + SEG_OVERHEAD_PX : 0;
  // Extra budget consumed by the "…" button + its separator when shown.
  const ellipsisPx = ELLIPSIS_PX + SEG_OVERHEAD_PX;

  // How many middle segments fit when we also reserve room for the "…" button?
  let visibleMiddleCount = 0;
  if (!forceExpanded && containerWidth > 0 && middleSegments.length > 0) {
    let budget = containerWidth - rootPx - lastPx - ellipsisPx;
    for (const seg of middleSegments) {
      const needed = estimateTextPx(seg) + SEG_OVERHEAD_PX;
      if (budget >= needed) {
        visibleMiddleCount++;
        budget -= needed;
      } else {
        break;
      }
    }
  }

  const showEllipsis =
    !forceExpanded && visibleMiddleCount < middleSegments.length;
  const visibleMiddle = forceExpanded
    ? middleSegments
    : middleSegments.slice(0, visibleMiddleCount);
  const hiddenMiddle = forceExpanded
    ? []
    : middleSegments.slice(visibleMiddleCount);

  // Report truncation to parent using the same character-width estimates used
  // for middle-segment budgeting — no DOM reads needed, no timing issues.
  // We're truncated if the container isn't wide enough to show root + last
  // segment comfortably, or if middle segments are hidden behind the ellipsis.
  //
  // Only report when the search is expanded (searchCompact=false). When compact
  // the search bar is w-7 so the breadcrumb is artificially wide — measuring
  // then would report "not truncated", expand the search, squeeze the breadcrumb
  // again, and loop. The LocatorBar resets searchCompact=false on path change,
  // which triggers a fresh evaluation with the expanded search width.
  const minNeededPx = rootPx + lastPx;
  const isTruncated =
    containerWidth > 0 && (showEllipsis || containerWidth < minNeededPx);
  const prevTruncatedRef = useRef<boolean | null>(null);
  // useLayoutEffect runs synchronously after DOM mutations, before paint —
  // same timing guarantee as the previous inline call, but through a supported
  // React mechanism that avoids calling a parent setState during a child render.
  useLayoutEffect(() => {
    // When searchCompact resets to false (path change), invalidate the cached
    // value so the next evaluation always fires onTruncatedChange with the
    // fresh reading.
    if (!searchCompact) prevTruncatedRef.current = null;
    if (!searchCompact && prevTruncatedRef.current !== isTruncated) {
      prevTruncatedRef.current = isTruncated;
      onTruncatedChange?.(isTruncated);
    }
  }, [searchCompact, isTruncated, onTruncatedChange]);

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 text-sm min-w-0 w-full flex-nowrap overflow-hidden"
    >
      <Link
        to={treeUrl(currentRef)}
        className="text-pink-600 dark:text-pink-400 hover:underline font-medium shrink-0"
        title={repoId}
      >
        {repoId}
      </Link>

      {/* Visible middle segments (before the ellipsis) */}
      {visibleMiddle.map((seg, i) => {
        const segPath = pathSegments.slice(0, i + 1).join("/");
        return (
          <span key={i} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Link
              to={treeUrl(currentRef, segPath)}
              className="text-pink-600 dark:text-pink-400 hover:underline"
            >
              {seg}
            </Link>
          </span>
        );
      })}

      {/* Ellipsis button — expands to show hidden middle segments */}
      {showEllipsis && hiddenMiddle.length > 0 && (
        <span className="flex items-center gap-1 shrink-0">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <button
            onClick={() => setForceExpanded(true)}
            className="flex items-center justify-center h-5 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs font-medium"
            title={`Show hidden path: ${hiddenMiddle.join("/")}`}
            aria-label="Expand path"
          >
            …
          </button>
        </span>
      )}

      {/* Last segment */}
      {pathSegments.length > 0 && (
        <span className="flex items-center gap-1 min-w-0">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium truncate min-w-0">{lastSegment}</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Go-to-file search
// ---------------------------------------------------------------------------

const MAX_RESULTS = 100;

/**
 * Renders a file path with the query substring bolded wherever it appears.
 * Long paths wrap onto multiple lines so the full path is always readable.
 */
function HighlightedPath({ path, query }: { path: string; query: string }) {
  const lower = query.toLowerCase();
  const lowerPath = path.toLowerCase();

  // Guard: an empty query string causes indexOf("", n) to always return n,
  // advancing cursor by 0 and looping forever.
  if (!lower) {
    return (
      <span className="flex-1 min-w-0 break-all text-muted-foreground">
        {path}
      </span>
    );
  }

  // Split the path into alternating non-match / match segments.
  const parts: { text: string; match: boolean }[] = [];
  let cursor = 0;
  while (cursor < path.length) {
    const idx = lowerPath.indexOf(lower, cursor);
    if (idx === -1) {
      parts.push({ text: path.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      parts.push({ text: path.slice(cursor, idx), match: false });
    }
    parts.push({ text: path.slice(idx, idx + lower.length), match: true });
    cursor = idx + lower.length;
  }

  return (
    <span className="flex-1 min-w-0 break-all">
      {parts.map((p, i) =>
        p.match ? (
          <strong key={i} className="font-semibold text-foreground">
            {p.text}
          </strong>
        ) : (
          <span key={i} className="text-muted-foreground">
            {p.text}
          </span>
        ),
      )}
    </span>
  );
}

function GoToFileSearch({
  fullFileTree,
  currentRef,
  treeUrl,
  pulling,
  compact = false,
}: {
  fullFileTree: FullFileTreeState & { triggerFetch: () => void };
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
  pulling: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset query and open state when the user switches branches/tags so the
  // input doesn't show a stale query string typed against a different ref.
  const prevRefRef = useRef(currentRef);
  if (prevRefRef.current !== currentRef) {
    prevRefRef.current = currentRef;
    if (query) setQuery("");
    if (open) setOpen(false);
  }

  // Filter entries against the query — search the full path, not just the filename.
  const { results, totalMatches } = useMemo<{
    results: FlatFileEntry[];
    totalMatches: number;
  }>(() => {
    if (!query.trim()) return { results: [], totalMatches: 0 };
    const lower = query.toLowerCase();
    const matched = fullFileTree.entries.filter((e) =>
      e.path.toLowerCase().includes(lower),
    );
    return {
      results: matched.slice(0, MAX_RESULTS),
      totalMatches: matched.length,
    };
  }, [query, fullFileTree.entries]);

  // Reset active index when results change. Depend on the array reference
  // (not results.length) so a same-count but different result set also resets.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Close on Escape.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      navigateTo(results[activeIndex]);
      return;
    }
  }

  const navigate = useNavigate();

  function navigateTo(entry: FlatFileEntry) {
    setOpen(false);
    setQuery("");
    navigate(treeUrl(currentRef, entry.path));
  }

  function handleFocus() {
    setOpen(true);
    // Kick off the background full-tree fetch (no-op if already done).
    fullFileTree.triggerFetch();
  }

  // Disable the input while the ref is still being resolved (no currentRef yet)
  // or while the pool is still pulling and we have no entries at all.
  const disabled =
    !currentRef || (pulling && fullFileTree.entries.length === 0);

  // Whether the popover content should be shown (open + has a query).
  const showDropdown = open && query.trim().length > 0;

  return (
    <Popover
      open={showDropdown}
      onOpenChange={(v) => {
        if (!v) {
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <div
          ref={triggerRef}
          className={cn(
            "flex items-center h-7 rounded border text-xs transition-all duration-150 cursor-text",
            open
              ? "gap-1.5 px-2 border-border bg-background w-48"
              : compact
                ? "justify-center px-1.5 border-border/40 bg-muted/20 w-7 hover:border-border/70 hover:bg-muted/40"
                : "gap-1.5 px-2 border-border/40 bg-muted/20 w-32 hover:border-border/70 hover:bg-muted/40",
            disabled && "opacity-40 pointer-events-none",
          )}
          onClick={() => inputRef.current?.focus()}
        >
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleFocus}
            onBlur={() => {
              // Closing is handled entirely by onInteractOutside on the
              // PopoverContent. Closing here would fire when the user clicks
              // the scrollbar (which blurs the input) and dismiss the dropdown.
            }}
            onKeyDown={handleKeyDown}
            placeholder="Go to file…"
            className={cn(
              "bg-transparent outline-none text-xs placeholder:text-muted-foreground/50 min-w-0 transition-all duration-150",
              open || !compact
                ? "flex-1 w-auto opacity-100"
                : "w-0 opacity-0 pointer-events-none",
            )}
            disabled={disabled}
            aria-label="Go to file"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
          />
          {open && query && fullFileTree.entries.length === 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>
      </PopoverTrigger>

      {/* Dropdown results — rendered via portal so it escapes overflow:hidden */}
      <PopoverContent
        className="p-0 w-[36rem] max-w-[90vw] overflow-hidden"
        align="start"
        side="bottom"
        sideOffset={4}
        avoidCollisions
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Prevent Radix's built-in close — we manage open state ourselves.
          // Only close when the interaction is outside the trigger too (Radix
          // fires this for the trigger element as well, but the Popover's own
          // open={showDropdown} already handles that case).
          e.preventDefault();
          // Close if the click target is outside the trigger wrapper (which
          // includes the search icon, padding, and the input itself).
          const target = e.target as Node | null;
          if (!triggerRef.current?.contains(target)) {
            setOpen(false);
            setQuery("");
          }
        }}
      >
        {results.length > 0 ? (
          <ScrollArea
            type="always"
            style={{
              maxHeight:
                "calc(var(--radix-popover-content-available-height) - 1rem)",
            }}
          >
            <ul role="listbox" className="py-1">
              {results.map((entry, i) => (
                <li
                  key={entry.path}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before click
                    navigateTo(entry);
                  }}
                  className={cn(
                    "flex items-start gap-2 px-3 py-2 cursor-pointer text-sm",
                    i === activeIndex ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {entry.type === "directory" ? (
                    <Folder className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  {/* Full path — wraps onto multiple lines for long paths */}
                  <HighlightedPath path={entry.path} query={query} />
                </li>
              ))}
              {/* Truncation hint */}
              {totalMatches > MAX_RESULTS && (
                <li className="px-3 py-2 text-xs text-muted-foreground border-t border-border/40">
                  Showing {MAX_RESULTS} of {totalMatches} — type more to narrow
                </li>
              )}
              {/* Loading indicator at the bottom when full tree is still loading */}
              {!fullFileTree.complete && (
                <li className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground border-t border-border/40">
                  <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  Loading full file tree…
                </li>
              )}
            </ul>
          </ScrollArea>
        ) : fullFileTree.entries.length === 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
            Loading…
          </div>
        ) : (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            No files matching{" "}
            <span className="font-medium text-foreground">
              &ldquo;{query}&rdquo;
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

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
  onRefAndSourceChange,
  headCommit,
  commitHash,
  repoId,
  pulling,
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
  fullFileTree,
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
  onRefAndSourceChange?: (defaultRef: string, newSource: string) => void;
  headCommit: ReturnType<typeof useGitExplorer>["headCommit"];
  commitHash: string | null;
  repoId: string;
  pulling: boolean;
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
  fullFileTree: FullFileTreeState & { triggerFetch: () => void };
}) {
  // Compute the full ref name for the pool's refStatus lookup
  const currentRefObj = refs.find((r) => r.name === currentRef);
  const currentRefFull = currentRefObj
    ? currentRefObj.isBranch
      ? `refs/heads/${currentRef}`
      : `refs/tags/${currentRef}`
    : "";

  // Collapse the go-to-file label when the breadcrumb is truncated.
  // Since compact mode only changes opacity (not width), there is no layout
  // feedback loop — no debounce needed.
  const [compactSearch, setCompactSearch] = useState(false);
  const pathKey = pathSegments.join("/");
  const prevPathKeyRef = useRef(pathKey);
  if (prevPathKeyRef.current !== pathKey) {
    prevPathKeyRef.current = pathKey;
    // Reset eagerly so the label is visible while the breadcrumb re-measures.
    // The breadcrumb's useLayoutEffect will set it back to true if still truncated.
    if (compactSearch) setCompactSearch(false);
  }
  const handleBreadcrumbTruncated = useCallback((truncated: boolean) => {
    setCompactSearch(truncated);
  }, []);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      {/* Single flex-wrap row.
          Order: [RefSelector] [Breadcrumb] [GoToFile hidden@mobile] [GitServerStatus hidden@narrow]
          The breadcrumb has flex-[1_1_12rem]: it fills available space and
          only wraps to a full-width second line when it can't fit at 12rem.
          GoToFile + GitServerStatus are hidden below the sm breakpoint so
          they disappear before the breadcrumb is forced to wrap. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 relative",
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
            onRefAndSourceChange={onRefAndSourceChange}
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
          <Skeleton className="h-8 w-28 shrink-0" />
        ) : null}

        {/* Breadcrumb — fills remaining space; wraps to full-width line 2
            only when it can't fit at its minimum width alongside the ref selector */}
        <div className="flex-[1_1_12rem] min-w-0">
          <CollapsibleBreadcrumb
            repoId={repoId}
            pathSegments={pathSegments}
            currentRef={currentRef}
            treeUrl={treeUrl}
            searchCompact={compactSearch}
            onTruncatedChange={handleBreadcrumbTruncated}
          />
        </div>

        {/* Right-side items — hidden below sm breakpoint */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {/* Go-to-file search — replaces "checked just now" text */}
          {cloneUrls.length > 0 && (
            <GoToFileSearch
              fullFileTree={fullFileTree}
              currentRef={currentRef}
              treeUrl={treeUrl}
              pulling={pulling}
              compact={compactSearch}
            />
          )}

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
      </div>

      {/* Commit summary row */}
      {headCommit ? (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-background border-t border-border/40">
          <Link
            to={`${basePath}/commit/${commitHash}`}
            className="flex items-center gap-3 min-w-0 flex-1 hover:bg-muted/20 transition-colors rounded -mx-1 px-1 -my-0.5 py-0.5"
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
                  headCommit.committer?.timestamp ??
                    headCommit.author.timestamp,
                  { addSuffix: true },
                )}
              </p>
            </div>
            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
              {commitHash?.slice(0, 8)}
            </code>
          </Link>
          <Link
            to={
              currentRef
                ? `${basePath}/commits/${currentRef}`
                : `${basePath}/commits`
            }
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 whitespace-nowrap"
            title="View commit history"
          >
            <History className="h-3.5 w-3.5" />
            <span>Commits</span>
          </Link>
        </div>
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
              allowHtml
            />
          </Suspense>
        </div>
      );
    }
    // Fall through to text/source view
  }

  // Plain text / source view — syntax highlighted with line numbers
  if (content !== null) {
    return <CodeBlock code={content} filename={filename} filePath={filePath} />;
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
              allowHtml
            />
          </Suspense>
        ) : (
          <pre className="text-sm whitespace-pre-wrap font-mono text-foreground/80 leading-relaxed break-words overflow-x-auto">
            {content}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
