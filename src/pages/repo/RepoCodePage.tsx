import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRepoContext } from "./RepoContext";
import { useGitExplorer, type FileEntry } from "@/hooks/useGitExplorer";
import { useGitRepoData } from "@/hooks/useGitRepoData";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Folder,
  FileText,
  ChevronRight,
  GitBranch,
  Tag,
  GitCommit,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Users,
  Radio,
  Globe,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

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
      {/* State sync warning */}
      {repoState === null && cloneUrls.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            No Nostr state event found. Displaying git server state. Ask the
            maintainer to run <code className="font-mono">ngit sync</code>.
          </p>
        </div>
      )}

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
                  content={explorer.fileContent}
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

/**
 * Compute the opacity of the staleness indicator based on how long ago we
 * last checked the git server. Returns a value between 0 and 1.
 */
function stalenessOpacity(lastCheckedAt: number | null): number {
  if (lastCheckedAt === null) return 0.35;
  const ageS = Math.max(0, Math.floor(Date.now() / 1000) - lastCheckedAt);
  if (ageS < 60) return 0;
  if (ageS < 600) return 0.08 + (ageS - 60) * (0.12 / 540);
  if (ageS < 3600) return 0.2 + (ageS - 600) * (0.2 / 3000);
  if (ageS < 86400) return 0.4 + (ageS - 3600) * (0.3 / 82800);
  return 0.7;
}

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
}) {
  const branches = refs.filter((r) => r.isBranch);
  const tags = refs.filter((r) => r.isTag);

  const barOpacity = pulling ? 0.5 : stalenessOpacity(lastCheckedAt);
  const showBar = pulling || barOpacity > 0;

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      {/* Staleness bar — thin line along the top edge */}
      <div
        className="h-0.5 w-full transition-opacity duration-700"
        style={
          showBar
            ? {
                backgroundColor: `hsl(var(--primary) / ${barOpacity})`,
                ...(pulling
                  ? { animation: "staleness-pulse 2s ease-in-out infinite" }
                  : {}),
              }
            : { backgroundColor: "transparent" }
        }
      />

      {/* Top bar: branch selector + breadcrumb + pulling status */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 flex-wrap">
        {/* Branch/tag selector */}
        {refs.length > 0 ? (
          <Select value={currentRef} onValueChange={onRefChange}>
            <SelectTrigger className="h-8 w-auto min-w-[120px] max-w-[200px] text-xs gap-1.5">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Select ref" />
            </SelectTrigger>
            <SelectContent>
              {branches.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <GitBranch className="h-3 w-3" />
                    Branches
                  </div>
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name} className="text-xs">
                      {b.name}
                      {b.isDefault && (
                        <Badge
                          variant="secondary"
                          className="ml-2 text-[10px] h-4 px-1"
                        >
                          default
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                </>
              )}
              {tags.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5 mt-1">
                    <Tag className="h-3 w-3" />
                    Tags
                  </div>
                  {tags.map((t) => (
                    <SelectItem key={t.name} value={t.name} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
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
                  <span className="font-medium truncate">{seg}</span>
                ) : (
                  <Link
                    to={treeUrl(currentRef, segPath)}
                    className="text-violet-600 dark:text-violet-400 hover:underline truncate"
                  >
                    {seg}
                  </Link>
                )}
              </span>
            );
          })}
        </div>

        {/* Pulling indicator — right side */}
        {pulling && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking…
          </span>
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
              {formatDistanceToNow(
                new Date(
                  (headCommit.committer?.timestamp ??
                    headCommit.author.timestamp) * 1000,
                ),
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

function RepoSidebar({ repo }: { repo: ResolvedRepo }) {
  return (
    <div className="space-y-4">
      {/* Maintainers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            Maintainers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {repo.maintainerSet.map((pk) => (
            <UserLink
              key={pk}
              pubkey={pk}
              avatarSize="md"
              nameClassName="text-sm"
            />
          ))}
          {repo.pendingMaintainers.length > 0 && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">
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
            </>
          )}
        </CardContent>
      </Card>

      {/* Topics */}
      {repo.labels.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              Topics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {repo.labels.map((label) => (
                <Badge key={label} variant="secondary" className="text-xs">
                  {label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clone URLs */}
      {repo.cloneUrls.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              Clone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {repo.cloneUrls.map((url) => (
              <CloneUrlRow key={url} url={url} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Web URLs */}
      {repo.webUrls.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              Web
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {repo.webUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {url}
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Relays */}
      {repo.relays.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Relays
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {repo.relays.map((relay) => (
                <p
                  key={relay}
                  className="text-xs text-muted-foreground font-mono truncate"
                  title={relay}
                >
                  {relay}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CloneUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
      <code className="flex-1 text-xs font-mono truncate text-foreground/80">
        {url}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
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

function FileContentViewer({
  filename,
  content,
}: {
  filename: string;
  content: string | null;
}) {
  if (content === null) {
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
  const isMarkdown = isMarkdownFile(filename);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-2.5 px-4 border-b border-border/40 bg-muted/20">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{filename}</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 ml-auto">
            {lang}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isMarkdown ? (
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
              <MarkdownContent content={content} />
            </Suspense>
          </div>
        ) : (
          <pre className="overflow-x-auto text-xs font-mono leading-relaxed p-4 text-foreground/85 max-h-[70vh]">
            <code>{content}</code>
          </pre>
        )}
      </CardContent>
    </Card>
  );
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
        const entry = await getObjectByPath(url, commitHash, readmePath);
        if (!entry || entry.isDir) throw new Error("not a file");
        // Check blob cache before hitting the network
        let bytes = await getCachedBlob(entry.hash);
        if (!bytes) {
          const obj = await getObject(url, entry.hash);
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
            <MarkdownContent content={content} />
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
