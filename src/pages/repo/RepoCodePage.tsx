import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRepoContext } from "./RepoContext";
import { useGitExplorer, type FileEntry } from "@/hooks/useGitExplorer";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const { cloneUrls, repoState, treeRef, treePath, repoId } = useRepoContext();
  const navigate = useNavigate();

  const explorer = useGitExplorer(cloneUrls, {
    ref: treeRef,
    path: treePath,
    knownHeadCommit: repoState?.headCommitId,
  });

  // Build the base URL for this repo (without /tree/...)
  const basePath = useMemo(() => {
    // Reconstruct from context — use the current URL minus the /tree/... suffix
    const pathname = window.location.pathname;
    const treeIdx = pathname.indexOf("/tree");
    return treeIdx !== -1 ? pathname.slice(0, treeIdx) : pathname;
  }, []);

  // URL for a given ref + path
  const treeUrl = (ref: string, path?: string) => {
    const base = `${basePath}/tree/${encodeURIComponent(ref)}`;
    return path ? `${base}/${path}` : base;
  };

  // Handle branch/tag selector change
  const handleRefChange = (newRef: string) => {
    navigate(treeUrl(newRef));
  };

  const currentRef = explorer.resolvedRef ?? treeRef ?? "";
  const currentPath = treePath ?? "";
  const pathSegments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  // Determine if we should show a README below the file tree
  const readmeEntry = explorer.fileTree?.find(
    (f) => f.type === "file" && f.name.toLowerCase().startsWith("readme"),
  );

  return (
    <div className="container max-w-screen-xl px-4 md:px-8 py-6 space-y-4">
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

          {/* File content viewer */}
          {!explorer.loading &&
            !explorer.isDirectory &&
            explorer.pathExists && (
              <FileContentViewer
                filename={pathSegments[pathSegments.length - 1] ?? ""}
                content={explorer.fileContent}
              />
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
}) {
  const branches = refs.filter((r) => r.isBranch);
  const tags = refs.filter((r) => r.isTag);

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      {/* Top bar: branch selector + breadcrumb */}
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
}: {
  loading: boolean;
  entries: FileEntry[] | null;
  currentPath: string;
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
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
}: {
  entry: FileEntry;
  currentRef: string;
  treeUrl: (ref: string, path?: string) => string;
}) {
  const isDir = entry.type === "directory";
  const isReadme = entry.name.toLowerCase().startsWith("readme");

  return (
    <Link
      to={treeUrl(currentRef, entry.path)}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
    >
      {isDir ? (
        <Folder className="h-4 w-4 text-blue-500 shrink-0" />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span
        className={cn(
          "text-sm flex-1 truncate",
          isDir ? "text-foreground font-medium" : "text-foreground/90",
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

    const abort = new AbortController();
    setLoading(true);
    setContent(null);

    Promise.any(
      cloneUrls.map(async (url) => {
        const entry = await getObjectByPath(url, commitHash, readmePath);
        if (!entry || entry.isDir) throw new Error("not a file");
        const obj = await getObject(url, entry.hash);
        if (!obj) throw new Error("blob missing");
        return new TextDecoder("utf-8", { fatal: false }).decode(obj.data);
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
  }, [cloneUrls.join(","), commitHash, readmePath]); // eslint-disable-line react-hooks/exhaustive-deps

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
