/**
 * CodeUnavailable — high-level "no code available" status for the file
 * explorer, modeled on EventSearchStatus.
 *
 * Renders a single headline describing the overall situation (no server
 * serving any code, reachable servers with no branches, or branches present
 * but the requested commit's objects missing) followed by a per-git-server
 * breakdown so the user can see exactly which server has which problem
 * (connection error, not found, empty repository, branch not found, missing
 * commit objects).
 */

import {
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  Inbox,
  Loader2,
  RotateCcw,
  SearchX,
  Server,
  ServerCrash,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GraspLogo } from "@/components/GraspLogo";
import { graspCloneUrlNpub } from "@/lib/nip34";
import { cn } from "@/lib/utils";
import type { UrlState, UrlErrorKind } from "@/lib/git-grasp-pool";
import type { GitExplorerErrorDetail } from "@/hooks/useGitExplorer";

// ---------------------------------------------------------------------------
// Per-server problem classification
// ---------------------------------------------------------------------------

type ServerProblem =
  | "connection-error"
  | "not-found"
  | "empty"
  | "branch-not-found"
  | "commit-missing"
  | "fetch-error"
  | "has-code"
  | "checking";

function shortLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

/** Condense the npub in a Grasp clone URL so the row fits on one line. */
function condenseGraspUrl(url: string): string {
  const npub = graspCloneUrlNpub(url);
  if (!npub || npub.length <= 12) return url;
  return url.replace(npub, `${npub.slice(0, 8)}…${npub.slice(-2)}`);
}

function branchKeys(urlState: UrlState): string[] {
  if (!urlState.infoRefs) return [];
  return Object.keys(urlState.infoRefs.refs).filter(
    (k) => k.startsWith("refs/heads/") && !k.endsWith("^{}"),
  );
}

function serverHasRef(urlState: UrlState, ref: string): boolean {
  if (!urlState.infoRefs) return false;
  const refs = urlState.infoRefs.refs;
  // Commit hash given directly, branch name, or tag name.
  if (/^[0-9a-f]{40}$/i.test(ref)) {
    return Object.values(refs).includes(ref);
  }
  return (
    refs[`refs/heads/${ref}`] !== undefined ||
    refs[`refs/tags/${ref}`] !== undefined ||
    refs[ref] !== undefined
  );
}

function classifyServer(
  urlState: UrlState | undefined,
  detail: GitExplorerErrorDetail,
): ServerProblem {
  if (!urlState || urlState.status === "untested") return "checking";

  if (urlState.status === "error" || urlState.status === "permanent-failure") {
    return urlState.lastErrorKind === "not-git" ||
      urlState.lastErrorKind === "http-error"
      ? "not-found"
      : "connection-error";
  }

  // status === "ok"
  if (branchKeys(urlState).length === 0) return "empty";

  // Server advertises branches. If a specific ref was requested and this
  // server doesn't have it, it's a branch-not-found situation here.
  if (detail.requestedRef && !serverHasRef(urlState, detail.requestedRef)) {
    return "branch-not-found";
  }

  // Branches exist (and the requested ref, if any). Prefer the per-server
  // object-fetch outcome recorded by the pool: it tells us whether THIS server
  // actually returned a valid response lacking the commit's objects, or whether
  // the packfile fetch/transport itself failed (which is NOT evidence the
  // server is missing the objects). Only fall back to the global detail.kind
  // when no object fetch was attempted against this server.
  const objectFetch = urlState.lastObjectFetch;
  if (
    objectFetch &&
    (!detail.requestedCommit ||
      objectFetch.commitHash.startsWith(detail.requestedCommit) ||
      detail.requestedCommit.startsWith(objectFetch.commitHash))
  ) {
    switch (objectFetch.result) {
      case "fetch-error":
        return "fetch-error";
      case "object-missing":
        return "commit-missing";
      case "ok":
        return "has-code";
    }
  }

  // No per-server object-fetch evidence — defer to the overall classification.
  return detail.kind === "commit-missing" ? "commit-missing" : "has-code";
}

// ---------------------------------------------------------------------------
// Per-server row
// ---------------------------------------------------------------------------

function connectionErrorText(errorKind: UrlErrorKind | null | undefined) {
  switch (errorKind) {
    case "not-http":
      return "SSH/non-HTTP URL — not fetchable in the browser";
    case "cors-blocked":
      return "blocked by CORS — direct and proxy both failed";
    case "proxy-error":
      return "proxy error — unreachable via CORS proxy";
    case "network":
      return "network error — server unreachable";
    case "transient":
      return "temporarily unreachable";
    default:
      return "could not connect";
  }
}

/**
 * Detail text for a server whose infoRefs succeeded but whose packfile
 * (git-upload-pack) fetch failed at the transport/parse level — i.e. we could
 * not read a valid response, so it's a connection/fetch problem rather than
 * the server genuinely lacking the commit's objects.
 */
function fetchErrorText(errorKind: UrlErrorKind | null | undefined) {
  switch (errorKind) {
    case "packfile-error":
      return "couldn't fetch the objects from this server (upload-pack failed)";
    case "http-error":
      return "server returned an error fetching the objects";
    case "cors-blocked":
      return "blocked by CORS while fetching the objects";
    case "proxy-error":
      return "proxy error while fetching the objects";
    case "network":
      return "network error while fetching the objects";
    default:
      return "couldn't fetch the objects from this server";
  }
}

function problemMeta(
  problem: ServerProblem,
  urlState: UrlState | undefined,
  detail: GitExplorerErrorDetail,
): { icon: React.ReactNode; label: string; detailText: string } {
  switch (problem) {
    case "connection-error":
      return {
        icon: (
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        ),
        label: "connection error",
        detailText: connectionErrorText(urlState?.lastErrorKind),
      };
    case "not-found":
      return {
        icon: (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        ),
        label: "not found",
        detailText: "no git repository served at this URL (404)",
      };
    case "empty":
      return {
        icon: (
          <Inbox className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ),
        label: "empty repository",
        detailText: "reachable, but no branches have been pushed yet",
      };
    case "branch-not-found":
      return {
        icon: (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ),
        label: "branch not found",
        detailText: detail.requestedRef
          ? `doesn't have a "${detail.requestedRef}" branch`
          : "doesn't have the requested branch",
      };
    case "commit-missing":
      return {
        icon: (
          <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ),
        label: "missing objects",
        detailText: detail.requestedCommit
          ? `doesn't have the objects for commit ${detail.requestedCommit.slice(0, 8)}`
          : "doesn't have this commit's objects yet",
      };
    case "fetch-error":
      return {
        icon: (
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        ),
        label: "fetch error",
        detailText: fetchErrorText(urlState?.lastObjectFetch?.errorKind),
      };
    case "has-code":
      return {
        icon: (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        ),
        label: "serving code",
        detailText: "this server has the code",
      };
    case "checking":
      return {
        icon: (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50" />
        ),
        label: "checking…",
        detailText: "still contacting this server",
      };
  }
}

function ServerRow({
  url,
  urlState,
  detail,
  isGrasp,
}: {
  url: string;
  urlState: UrlState | undefined;
  detail: GitExplorerErrorDetail;
  isGrasp: boolean;
}) {
  const problem = classifyServer(urlState, detail);
  const { icon, label, detailText } = problemMeta(problem, urlState, detail);
  const isError =
    problem === "connection-error" ||
    problem === "not-found" ||
    problem === "fetch-error";
  const displayUrl = isGrasp ? condenseGraspUrl(url) : shortLabel(url);

  return (
    <li className="flex items-start gap-2 py-1">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate font-mono text-xs",
              isError
                ? "text-red-600/80 dark:text-red-400/80 line-through"
                : "text-foreground/80",
            )}
            title={url}
          >
            {displayUrl}
          </span>
          <span
            className={cn(
              "ml-auto shrink-0 text-[11px] font-sans",
              isError
                ? "text-red-600 dark:text-red-400"
                : problem === "has-code"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : problem === "checking"
                    ? "text-muted-foreground/60"
                    : "text-amber-600 dark:text-amber-400",
            )}
          >
            {label}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">{detailText}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function headlineFor(detail: GitExplorerErrorDetail): {
  icon: React.ReactNode;
  headline: string;
  description: string;
} {
  switch (detail.kind) {
    case "no-servers":
      return {
        icon: <ServerCrash className="h-8 w-8 text-destructive/70" />,
        headline: "No git server is serving this repository",
        description:
          "None of the announced clone URLs returned the code. It may not have been pushed yet, or the servers are currently unreachable.",
      };
    case "no-branches":
      return {
        icon: <Inbox className="h-8 w-8 text-muted-foreground" />,
        headline: "This repository has no code yet",
        description:
          "The connected git server(s) are reachable but aren't serving any branches.",
      };
    case "commit-missing":
      return {
        icon: <SearchX className="h-8 w-8 text-muted-foreground" />,
        headline: detail.requestedCommit
          ? `Commit ${detail.requestedCommit.slice(0, 8)} isn't available`
          : "This commit isn't available",
        description:
          "The connected git server(s) don't have the objects for this commit yet.",
      };
    case "fetch-failed":
      return {
        icon: <ServerCrash className="h-8 w-8 text-destructive/70" />,
        headline: "Couldn't fetch the code from the git server(s)",
        description:
          "The git server(s) are reachable, but every attempt to fetch the objects failed at the transport level (not a case of missing objects). This is often a temporary network/proxy problem or a browser compatibility issue — retrying may help.",
      };
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface CodeUnavailableProps {
  detail: GitExplorerErrorDetail;
  /** Per-URL state from PoolState.urls */
  urls: Record<string, UrlState>;
  /** All announced clone URLs (display order) */
  cloneUrls: string[];
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls?: string[];
  /** Retry the explorer fetch across all servers */
  onReload?: () => void;
}

export function CodeUnavailable({
  detail,
  urls,
  cloneUrls,
  graspCloneUrls = [],
  onReload,
}: CodeUnavailableProps) {
  const { icon, headline, description } = headlineFor(detail);

  const graspUrls = cloneUrls.filter((u) => graspCloneUrls.includes(u));
  const otherUrls = cloneUrls.filter((u) => !graspUrls.includes(u));

  const renderGroup = (label: string, isGrasp: boolean, list: string[]) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {isGrasp ? (
            <GraspLogo className="h-3 w-3 text-pink-500" />
          ) : (
            <Server className="h-3 w-3" />
          )}
          {label}
        </div>
        <ul className="space-y-0.5">
          {list.map((url) => (
            <ServerRow
              key={url}
              url={url}
              urlState={urls[url]}
              detail={detail}
              isGrasp={isGrasp}
            />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="py-8">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="p-4 rounded-full bg-muted">{icon}</div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">{headline}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        {/* Per-server breakdown */}
        {cloneUrls.length > 0 && (
          <Card className="relative">
            {onReload && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={onReload}
                title="Retry all servers"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            <CardContent className="p-4 space-y-4">
              {graspUrls.length > 0 && otherUrls.length > 0 ? (
                <>
                  {renderGroup("Grasp Servers", true, graspUrls)}
                  {renderGroup("Other Git Servers", false, otherUrls)}
                </>
              ) : graspUrls.length > 0 ? (
                renderGroup("Grasp Servers", true, graspUrls)
              ) : (
                renderGroup("Git Servers", false, cloneUrls)
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
