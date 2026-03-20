import {
  lazy,
  Suspense,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRepoContext } from "./RepoContext";
import { useGitExplorer, type FileEntry } from "@/hooks/useGitExplorer";
import { useGitRepoData } from "@/hooks/useGitRepoData";
import { UserLink } from "@/components/UserAvatar";
import { RefSelector } from "@/components/RefSelector";
import { GitServerStatus } from "@/components/GitServerStatus";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { UrlInfoRefsResult } from "@/services/gitRepoDataService";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Folder,
  FileText,
  ChevronRight,
  GitBranch,
  GitCommit,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Globe,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  Eye,
  Code,
  Download,
} from "lucide-react";
import { getFileMediaType, toDataUri } from "@/lib/fileMediaType";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";

const MarkdownContent = lazy(() => import("@/components/MarkdownContent"));

// ---------------------------------------------------------------------------
// File extension → language mapping for syntax highlighting hint
// ---------------------------------------------------------------------------
function getLanguageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    h: "c",
    hpp: "cpp",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    rb: "ruby",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    ps1: "powershell",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    sql: "sql",
    md: "markdown",
    markdown: "markdown",
    nix: "nix",
    dockerfile: "dockerfile",
    makefile: "makefile",
    mk: "makefile",
    lock: "toml",
    env: "bash",
  };
  return map[ext] ?? "plaintext";
}

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
    treeRefAndPath,
    repoId,
    resolved,
  } = useRepoContext();
  const navigate = useNavigate();
  const repo = resolved?.repo;

  const explorer = useGitExplorer(cloneUrls, {
    refAndPath: treeRefAndPath,
    knownHeadCommit: repoState?.headCommitId,
  });

  // Git repo data for the pulling signal (shares the same underlying service
  // entry as useGitExplorer via clone URLs — no duplicate fetches).
  const gitData = useGitRepoData(cloneUrls, {
    knownHeadCommit: repoState?.headCommitId,
    stateRefs: repoState?.refs,
    stateCreatedAt: repoState ? repoState.event.created_at : undefined,
  });

  // Combined "pulling" signal: true while either Nostr relay EOSE is pending
  // or the git server fetch is in flight with stale data already shown.
  const pulling =
    cloneUrls.length > 0 ? !repoRelayEose || gitData.pulling : false;

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

  const currentRef = explorer.resolvedRef ?? "";
  const currentPath = explorer.resolvedPath ?? "";
  const pathSegments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  // Show the sidebar when at the repo root (no sub-path within the tree)
  const isAtRoot = !treeRefAndPath || pathSegments.length === 0;

  // Determine if we should show a README below the file tree
  const readmeEntry = explorer.fileTree?.find(
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
            loading={explorer.loading}
            refs={explorer.refs}
            currentRef={currentRef}
            pathSegments={pathSegments}
            basePath={basePath}
            treeUrl={treeUrl}
            onRefChange={handleRefChange}
            headCommit={explorer.headCommit}
            commitHash={explorer.commitHash}
            repoId={repoId}
            pulling={pulling}
            lastCheckedAt={gitData.lastCheckedAt}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            urlInfoRefs={gitData.urlInfoRefs}
            cloneUrls={cloneUrls}
            graspCloneUrls={repo?.graspCloneUrls ?? []}
            additionalGitServerUrls={repo?.additionalGitServerUrls ?? []}
          />

          {/* Error state */}
          {explorer.error && (
            <Card className="border-destructive/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{explorer.error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Path not found */}
          {!explorer.loading && !explorer.error && !explorer.pathExists && (
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
          {(explorer.loading ||
            (explorer.fileTree && explorer.isDirectory)) && (
            <FileTreeTable
              loading={explorer.loading}
              entries={explorer.fileTree}
              currentPath={currentPath}
              currentRef={currentRef}
              treeUrl={treeUrl}
            />
          )}

          {/* Parent directory listing + file content viewer (file view) */}
          {!explorer.loading &&
            !explorer.isDirectory &&
            explorer.pathExists && (
              <>
                {explorer.parentFileTree && (
                  <FileTreeTable
                    loading={false}
                    entries={explorer.parentFileTree}
                    currentPath={pathSegments.slice(0, -1).join("/")}
                    currentRef={currentRef}
                    treeUrl={treeUrl}
                    activeFile={pathSegments[pathSegments.length - 1]}
                  />
                )}
                <FileContentViewer
                  filename={pathSegments[pathSegments.length - 1] ?? ""}
                  filePath={explorer.resolvedPath ?? ""}
                  content={explorer.fileContent}
                  fileBytes={explorer.fileBytes}
                  cloneUrls={cloneUrls}
                  commitHash={explorer.commitHash}
                />
              </>
            )}

          {/* README below file tree */}
          {!explorer.loading &&
            explorer.isDirectory &&
            readmeEntry &&
            explorer.commitHash && (
              <ReadmeViewer
                cloneUrls={cloneUrls}
                commitHash={explorer.commitHash}
                readmePath={readmeEntry.path}
                readmeName={readmeEntry.name}
              />
            )}
        </>
      )}
    </div>
  );

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6">
      {isAtRoot && repo ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
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
  headCommit,
  commitHash,
  repoId,
  pulling,
  lastCheckedAt,
  repoState,
  repoRelayEose,
  urlInfoRefs,
  cloneUrls,
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  loading: boolean;
  refs: ReturnType<typeof useGitExplorer>["refs"];
  currentRef: string;
  pathSegments: string[];
  basePath: string;
  treeUrl: (ref: string, path?: string) => string;
  onRefChange: (ref: string) => void;
  headCommit: ReturnType<typeof useGitExplorer>["headCommit"];
  commitHash: string | null;
  repoId: string;
  pulling: boolean;
  lastCheckedAt: number | null;
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  cloneUrls: string[];
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  // Hide "checked" text if showing it would cause the bar to wrap onto
  // multiple lines. We directly manipulate the DOM via refs to avoid a
  // render cycle — measure height without it, then with it, and show/hide
  // accordingly.
  const barRef = useRef<HTMLDivElement>(null);
  const checkedRef = useRef<HTMLSpanElement>(null);

  const hasRepoState = !!repoState;
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
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            loading={loading}
          />
        ) : loading ? (
          <Skeleton className="h-8 w-28" />
        ) : null}

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm min-w-0 flex-1 flex-wrap">
          <Link
            to={treeUrl(currentRef)}
            className="text-violet-600 dark:text-violet-400 hover:underline font-medium shrink-0"
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
                    className="text-violet-600 dark:text-violet-400 hover:underline"
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
            currentRef={currentRef}
            refs={refs}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            urlInfoRefs={urlInfoRefs}
            cloneUrls={cloneUrls}
            graspCloneUrls={graspCloneUrls}
            additionalGitServerUrls={additionalGitServerUrls}
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
      ) : loading ? (
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
            isActive ? "text-violet-500" : "text-muted-foreground",
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
import { nip19 } from "nostr-tools";
function RepoSidebar({ repo }: { repo: ResolvedRepo }) {
  // Build the nostr:// clone URL for ngit
  let npub: string | undefined;
  try {
    npub = nip19.npubEncode(repo.selectedMaintainer);
  } catch {
    npub = undefined;
  }
  const nostrCloneUrl = npub ? `nostr://${npub}/${repo.dTag}` : undefined;
  const nostrCloneCommand = nostrCloneUrl
    ? `git clone ${nostrCloneUrl}`
    : undefined;

  const hasAnyCloneUrl =
    repo.graspCloneUrls.length > 0 || repo.additionalGitServerUrls.length > 0;

  return (
    <div className="space-y-3 min-w-0">
      {/* Clone button — always shown if we have a nostr URL or any clone URLs */}
      {(nostrCloneCommand || hasAnyCloneUrl) && (
        <CloneDropdown
          nostrCloneCommand={nostrCloneCommand}
          nostrCloneUrl={nostrCloneUrl}
          graspCloneUrls={repo.graspCloneUrls}
          additionalGitServerUrls={repo.additionalGitServerUrls}
        />
      )}

      {/* About card: description + web + maintainers + topics */}
      <Card className="overflow-hidden">
        <CardContent className="pt-4 pb-4 space-y-4">
          {/* About heading + description */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              About
            </p>
            {repo.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {repo.description}
              </p>
            )}
          </div>

          {/* Web URLs */}
          {repo.webUrls.length > 0 && (
            <div className="space-y-1">
              {repo.webUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline min-w-0"
                  title={url}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{url}</span>
                </a>
              ))}
            </div>
          )}

          {/* Maintainers */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Maintainers
            </p>
            <div className="space-y-2">
              {repo.maintainerSet.map((pk) => (
                <UserLink
                  key={pk}
                  pubkey={pk}
                  avatarSize="sm"
                  nameClassName="text-sm"
                />
              ))}
            </div>
            {repo.pendingMaintainers.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-muted-foreground/70">
                  Pending (no announcement)
                </p>
                {repo.pendingMaintainers.map((pk) => (
                  <UserLink
                    key={pk}
                    pubkey={pk}
                    avatarSize="sm"
                    nameClassName="text-xs text-muted-foreground"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Topics */}
          {repo.labels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Topics
              </p>
              <div className="flex flex-wrap gap-1.5">
                {repo.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clone dropdown — prominent button that opens a popover
// ---------------------------------------------------------------------------

function CloneDropdown({
  nostrCloneCommand,
  nostrCloneUrl,
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  nostrCloneCommand: string | undefined;
  nostrCloneUrl: string | undefined;
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  const [open, setOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  const handleCopyCommand = async () => {
    if (!nostrCloneCommand) return;
    await navigator.clipboard.writeText(nostrCloneCommand);
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const hasRawUrls =
    graspCloneUrls.length > 0 || additionalGitServerUrls.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-between gap-2 bg-violet-600 hover:bg-violet-700 text-white border-0"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0" />
            <span>Clone</span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 overflow-hidden"
        align="start"
        sideOffset={4}
      >
        {/* ngit section */}
        {nostrCloneCommand && nostrCloneUrl && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                Clone with ngit
              </p>
              <a
                href="https://ngit.dev/install"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
              >
                Install ngit
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {/* Command block */}
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-2 min-w-0">
              <code
                className="flex-1 text-xs font-mono text-foreground/90 truncate min-w-0 select-all"
                title={nostrCloneCommand}
              >
                {nostrCloneCommand}
              </code>
              <button
                onClick={handleCopyCommand}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                title="Copy command"
              >
                {copiedCommand ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Raw git URLs */}
        {hasRawUrls && (
          <>
            {nostrCloneCommand && <Separator />}
            <div className="p-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">
                Raw git URLs
              </p>
              <div className="space-y-1.5">
                {graspCloneUrls.map((url) => (
                  <CloneUrlRow key={url} url={url} />
                ))}
                {additionalGitServerUrls.map((url) => (
                  <CloneUrlRow key={url} url={url} />
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
function CloneUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 min-w-0">
      <code
        className="flex-1 text-xs font-mono truncate text-foreground/80 min-w-0"
        title={url}
      >
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
        title="Copy URL"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
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
    const blob = new Blob([fileBytes.buffer as ArrayBuffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileBytes, filename]);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

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

  const lang = getLanguageFromFilename(filename);
  const canToggle = mediaType?.kind === "markdown" || mediaType?.kind === "svg";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-2.5 px-4 border-b border-border/40 bg-muted/20">
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
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
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
                      ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Code className="h-3 w-3" />
                  Source
                </button>
              </>
            )}

            {/* Language badge for non-binary, non-toggle files */}
            {!canToggle && !isBinaryMedia && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                {lang}
              </Badge>
            )}

            {/* Download — icon only, binary media only */}
            {isBinaryMedia && fileBytes && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Download file"
              >
                <Download className="h-3 w-3" />
              </button>
            )}

            {/* Copy — text/code/markdown */}
            {!isBinaryMedia && content !== null && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title="Copy file content"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
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

  // Plain text / source view
  if (content !== null) {
    return (
      <pre className="overflow-x-auto text-xs font-mono leading-relaxed p-4 text-foreground/85">
        <code>{content}</code>
      </pre>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// README viewer (fetched lazily below the file tree)
// ---------------------------------------------------------------------------

import { getObject, getObjectByPath } from "@fiatjaf/git-natural-api";
import {
  getCachedText,
  cacheText,
  getCachedBlob,
  cacheBlob,
} from "@/services/gitObjectCache";
import { resolveGitUrl } from "@/lib/corsProxy";
import { BookOpen } from "lucide-react";

function ReadmeViewer({
  cloneUrls,
  commitHash,
  readmePath,
  readmeName,
}: {
  cloneUrls: string[];
  commitHash: string;
  readmePath: string;
  readmeName: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!commitHash || cloneUrls.length === 0) return;

    // Check text cache first (synchronous, no loading flash on remount)
    const cachedText = getCachedText(commitHash, readmeName);
    if (cachedText !== undefined) {
      setContent(cachedText);
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setContent(null);

    Promise.any(
      cloneUrls.map(async (url) => {
        const effectiveUrl = resolveGitUrl(url);
        const entry = await getObjectByPath(
          effectiveUrl,
          commitHash,
          readmePath,
        );
        if (!entry || entry.isDir) throw new Error("not a file");
        // Check blob cache before hitting the network
        let bytes = await getCachedBlob(entry.hash);
        if (!bytes) {
          const obj = await getObject(effectiveUrl, entry.hash);
          if (!obj) throw new Error("blob missing");
          cacheBlob(entry.hash, obj.data);
          bytes = obj.data;
        }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        cacheText(commitHash, readmeName, text);
        return text;
      }),
    )
      .then((text) => {
        if (abort.signal.aborted) return;
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setLoading(false);
      });

    return () => abort.abort();
  }, [cloneUrls.join(","), commitHash, readmePath, readmeName]); // eslint-disable-line react-hooks/exhaustive-deps

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
