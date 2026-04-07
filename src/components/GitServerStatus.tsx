import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Check,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Copy,
  Server,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import { GraspLogo } from "@/components/GraspLogo";
import { GitServerStatusIcon } from "@/components/GitServerStatusIcon";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { graspCloneUrlNpub } from "@/lib/nip34";
import type {
  UrlState,
  UrlRefStatus,
  UrlErrorKind,
  RefDiscrepancy,
  PoolWarning,
  GitGraspPool,
} from "@/lib/git-grasp-pool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitServerStatusProps {
  /**
   * Full ref name for the currently selected ref
   * (e.g. "refs/heads/main" or "refs/tags/v1.0").
   * Used to look up per-URL ref status from the pool.
   */
  currentRefFull: string;
  /** Short display name for the current ref (e.g. "main") */
  currentRefShort: string;
  /** True once the relay EOSE has been received for the state query */
  repoRelayEose: boolean;
  /** Whether a Nostr state event exists for this repo */
  hasStateEvent: boolean;
  /** Per-URL state from PoolState.urls — the pool's native shape. */
  urlStates: Record<string, UrlState>;
  /** All clone URLs for this repo */
  cloneUrls: string[];
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls: string[];
  /** Subset of cloneUrls that are NOT Grasp server clone URLs */
  additionalGitServerUrls: string[];
  /**
   * Cross-ref discrepancies computed by the pool (PoolState.crossRefDiscrepancies).
   * Refs where servers disagree on the commit.
   */
  crossRefDiscrepancies: RefDiscrepancy[];
  /**
   * Pool warning — used to detect when a git server is ahead of the signed
   * state so we can annotate "signed" labels accordingly.
   */
  poolWarning?: PoolWarning | null;
  /**
   * Unix timestamp (seconds) of the Nostr state event — used to show
   * how stale the signed state is relative to what git servers have.
   */
  stateCreatedAt?: number;
  /**
   * Pool instance — used to lazily fetch commit timestamps for servers
   * that differ from the signed state, so we can distinguish "behind"
   * (older commit) from "diverged" (different but not necessarily older).
   */
  pool?: GitGraspPool | null;
}

// ---------------------------------------------------------------------------
// Per-server status helpers
// ---------------------------------------------------------------------------

interface ServerStatus {
  url: string;
  /** Short display label derived from the URL */
  label: string;
  status: UrlRefStatus;
  /** The commit this server has for the current ref (if known) */
  serverCommit?: string;
  /** The expected commit (state event or majority) for the current ref */
  expectedCommit?: string;
  /** Whether this URL is currently routed through the CORS proxy. */
  usesProxy: boolean;
  /** Structured error reason from the pool — drives specific UI messages */
  errorKind?: UrlErrorKind | null;
}

function shortLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

/**
 * Build per-server status for the currently selected ref directly from
 * pool-computed UrlState data. No ref comparison logic here — the pool
 * already did it.
 */
function buildServerStatuses(
  currentRefFull: string,
  urlStates: Record<string, UrlState>,
  cloneUrls: string[],
): ServerStatus[] {
  return cloneUrls.map((url) => {
    const urlState = urlStates[url];
    const label = shortLabel(url);
    const usesProxy = urlState?.usesProxy ?? false;

    if (!urlState || urlState.status === "untested") {
      return { url, label, status: "unknown", usesProxy };
    }

    if (
      urlState.status === "permanent-failure" ||
      urlState.status === "error"
    ) {
      return {
        url,
        label,
        status: "error",
        usesProxy,
        errorKind: urlState.lastErrorKind,
      };
    }

    // status === "ok" — read pool-computed ref status
    const status: UrlRefStatus =
      urlState.refStatus[currentRefFull] ?? "connected";
    const serverCommit = urlState.refCommits[currentRefFull];

    return { url, label, status, serverCommit, usesProxy };
  });
}

// ---------------------------------------------------------------------------
// Grasp URL helpers
// ---------------------------------------------------------------------------

function npubToPubkey(npub: string): string | undefined {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Condense a full npub into `npub1…xx` form (first 8 chars + "…" + last 2).
 * e.g. "npub1abc123def456" → "npub1abc…56"
 */
function condenseNpub(npub: string): string {
  if (npub.length <= 12) return npub;
  return npub.slice(0, 8) + "…" + npub.slice(-2);
}

/**
 * For a Grasp clone URL, replace the full npub in the URL string with the
 * condensed form so the URL fits on one line without losing context.
 */
function condenseGraspUrl(url: string): string {
  const npub = graspCloneUrlNpub(url);
  if (!npub) return url;
  return url.replace(npub, condenseNpub(npub));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ServerStatusDot({
  status,
  gitIsAhead,
}: {
  status: UrlRefStatus;
  gitIsAhead?: boolean;
}) {
  // When git is confirmed ahead of signed state, a "behind" server actually
  // has the *newer* commit — show it as amber warning, not a red X.
  if (status === "behind" && gitIsAhead) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "behind":
      return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "ahead":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "error":
      return (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
      );
    case "connected":
      return (
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      );
    case "unknown":
      return (
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      );
  }
}

function ServerStatusLabel({
  status,
  hasState,
  gitIsAhead,
  refinedBehindLabel,
}: {
  status: UrlRefStatus;
  hasState: boolean;
  /** True when a git server is confirmed ahead of the signed state */
  gitIsAhead?: boolean;
  /**
   * Refined label for the "behind" status — determined by comparing the
   * server's commit timestamp to the state event's created_at.
   * "differs" while loading (safe default), "behind signed" if older,
   * "diverged" if same age or newer.
   */
  refinedBehindLabel?: "behind signed" | "diverged" | "differs";
}) {
  // When git is confirmed ahead of signed state:
  //   "match"  → server has the old signed commit (not the latest)
  //   "behind" → server actually has the *newer* commit (ahead of signed)
  if (gitIsAhead && hasState) {
    switch (status) {
      case "match":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            signed, behind
          </span>
        );
      case "behind":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            unsigned ahead
          </span>
        );
      default:
        break;
    }
  }

  switch (status) {
    case "match":
      return (
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">
          {hasState ? "signed" : "in sync"}
        </span>
      );
    case "behind":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          {hasState ? (refinedBehindLabel ?? "differs") : "differs"}
        </span>
      );
    case "ahead":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          ahead
        </span>
      );
    case "error":
      return (
        <span className="text-[10px] text-muted-foreground/80 shrink-0">
          error
        </span>
      );
    case "connected":
      return (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          checking…
        </span>
      );
    case "unknown":
      return (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">…</span>
      );
  }
}

function ProxyBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 cursor-default leading-none">
          proxy
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        className="text-xs max-w-[220px]"
        sideOffset={6}
      >
        Fetched via cors.isomorphic-git.org — this server does not support
        cross-origin requests
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Error detail line
// ---------------------------------------------------------------------------

/**
 * Renders a specific, human-readable error message for a failed server URL.
 * Replaces the generic "unreachable" with actionable context.
 */
function ErrorDetail({
  errorKind,
  usesProxy,
}: {
  errorKind?: UrlErrorKind | null;
  usesProxy: boolean;
}) {
  let message: string;

  switch (errorKind) {
    case "not-http":
      message = "SSH/non-HTTP URL — not fetchable in browser";
      break;
    case "not-git":
      message = usesProxy
        ? "no git data via proxy — wrong path or 404"
        : "no git data — wrong path or 404";
      break;
    case "cors-blocked":
      message = "CORS blocked — direct and proxy both failed";
      break;
    case "proxy-error":
      message = "proxy error — server unreachable via proxy";
      break;
    case "http-error":
      message = "HTTP error — server returned 4xx/5xx";
      break;
    case "network":
      message = "network error — server unreachable";
      break;
    case "transient":
      message = "temporarily unreachable";
      break;
    default:
      message = "unreachable";
  }

  return (
    <p className="text-[11px] text-muted-foreground/80 mt-0.5">{message}</p>
  );
}

// ---------------------------------------------------------------------------
// Clone URLs section
// ---------------------------------------------------------------------------

/**
 * A single server row — used for both Grasp and plain git server URLs.
 * For Grasp URLs the npub in the URL is condensed and the owner avatar/name
 * is shown after the URL.
 */
function ServerRow({
  serverStatus,
  hasState,
  isGrasp,
  gitIsAhead,
  stateCreatedAt,
  gitCommitterDate,
  pool,
}: {
  serverStatus: ServerStatus;
  hasState: boolean;
  isGrasp: boolean;
  /** True when a git server is confirmed ahead of the signed state */
  gitIsAhead?: boolean;
  /** Unix timestamp (seconds) of the Nostr state event */
  stateCreatedAt?: number;
  /** Unix timestamp (seconds) of the git server's latest commit (when git is ahead) */
  gitCommitterDate?: number;
  pool?: GitGraspPool | null;
}) {
  const [copied, setCopied] = useState(false);

  // Lazily fetch the server's commit timestamp when it differs from the signed
  // state, so we can distinguish "behind signed" (older) from "diverged"
  // (different but not necessarily older). null = fetch failed/not needed.
  const [serverCommitTs, setServerCommitTs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const needsTimestampCheck =
    serverStatus.status === "behind" &&
    hasState &&
    !gitIsAhead &&
    !!serverStatus.serverCommit &&
    !!pool &&
    stateCreatedAt !== undefined;

  useEffect(() => {
    if (!needsTimestampCheck) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    pool!
      .getSingleCommit(serverStatus.serverCommit!, ac.signal)
      .then((commit) => {
        if (ac.signal.aborted || !commit) return;
        const ts = commit.committer?.timestamp ?? commit.author.timestamp;
        setServerCommitTs(ts);
      })
      .catch(() => {
        /* ignore — label stays "differs" */
      });

    return () => {
      ac.abort();
    };
  }, [needsTimestampCheck, serverStatus.serverCommit, pool]);

  // Determine the refined label for a "behind" server:
  //   - while loading (serverCommitTs null): show "differs" (safe default)
  //   - commit older than state event: "behind signed"
  //   - commit same age or newer: "diverged"
  const refinedBehindLabel: "behind signed" | "diverged" | "differs" =
    !needsTimestampCheck
      ? "differs"
      : serverCommitTs === null
        ? "differs"
        : serverCommitTs < stateCreatedAt!
          ? "behind signed"
          : "diverged";

  const handleCopy = () => {
    navigator.clipboard.writeText(serverStatus.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const npub = isGrasp
    ? (graspCloneUrlNpub(serverStatus.url) ?? undefined)
    : undefined;
  const pubkey = npub ? npubToPubkey(npub) : undefined;

  const displayUrl = isGrasp
    ? condenseGraspUrl(serverStatus.url)
    : serverStatus.url;

  // When git is confirmed ahead of signed state, the pool's "behind" label is
  // inverted from the user's perspective:
  //   pool "behind" = this server has the *newer* unsigned commit (ahead of signed)
  //   pool "match"  = this server has the *old* signed commit (not the latest)
  const serverIsUnsignedAhead =
    serverStatus.status === "behind" && hasState && gitIsAhead;
  const serverIsSignedOnly =
    serverStatus.status === "match" && hasState && gitIsAhead;

  // A server "has the selected state" when its commit matches what is currently
  // being shown. When git is ahead of the signed state, the servers with the
  // *newer* unsigned commit (pool status "behind") are the ones serving the
  // current view. Otherwise, "match" means the server has the signed state.
  const hasSelectedState = gitIsAhead
    ? serverStatus.status === "behind"
    : serverStatus.status === "match";

  // The highlight color follows the status dot color so the accent is
  // semantically consistent: emerald for a clean signed match, amber when
  // the server is serving unsigned-ahead commits.
  const selectedHighlight = hasSelectedState
    ? gitIsAhead
      ? ("amber" as const)
      : ("emerald" as const)
    : null;

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors relative cursor-pointer",
        selectedHighlight === "emerald" &&
          "bg-emerald-500/5 border-l-2 border-emerald-500 pl-[14px] hover:bg-emerald-500/10",
        selectedHighlight === "amber" &&
          "bg-amber-500/5 border-l-2 border-amber-500 pl-[14px] hover:bg-amber-500/10",
        !selectedHighlight && "hover:bg-accent/30",
      )}
      aria-label={`Copy clone URL: ${serverStatus.url}`}
    >
      <ServerStatusDot status={serverStatus.status} gitIsAhead={gitIsAhead} />

      <div className="min-w-0 flex-1">
        {/* URL + identity bubble on the same line */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <p
            className={cn(
              "font-mono text-[10px] break-all leading-snug",
              serverStatus.status === "error"
                ? "text-muted-foreground/80"
                : hasSelectedState
                  ? "text-foreground/90"
                  : "text-foreground/80",
            )}
            title={serverStatus.url}
          >
            {displayUrl}
          </p>
          {isGrasp && (pubkey ?? npub) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border/60 bg-popover px-1.5 py-0.5 shadow-sm whitespace-nowrap font-sans leading-none shrink-0",
                serverStatus.status === "error" && "opacity-60 grayscale",
              )}
            >
              {pubkey ? (
                <>
                  <UserAvatar
                    pubkey={pubkey}
                    size="xs"
                    className="h-3.5 w-3.5 text-[6px] shrink-0"
                  />
                  <UserName
                    pubkey={pubkey}
                    className="text-[10px] text-muted-foreground font-normal"
                  />
                </>
              ) : (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {condenseNpub(npub!)}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Server has unannounced commits — ahead of the Nostr state */}
        {serverIsUnsignedAhead && serverStatus.serverCommit && (
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
            has unannounced commit{" "}
            <code className="bg-muted px-1 rounded">
              {serverStatus.serverCommit.slice(0, 8)}
            </code>
            {gitCommitterDate && (
              <span className="text-muted-foreground/70">
                {" "}
                (
                {safeFormatDistanceToNow(gitCommitterDate, { addSuffix: true })}
                )
              </span>
            )}
            {serverStatus.expectedCommit && (
              <span className="text-muted-foreground/60">
                {" "}
                · signed was{" "}
                <code className="bg-muted px-1 rounded">
                  {serverStatus.expectedCommit.slice(0, 8)}
                </code>
                {stateCreatedAt && (
                  <span>
                    {" "}
                    (
                    {safeFormatDistanceToNow(stateCreatedAt, {
                      addSuffix: true,
                    })}
                    )
                  </span>
                )}
              </span>
            )}
          </p>
        )}

        {/* Server only has the Nostr commit — another server is ahead */}
        {serverIsSignedOnly && serverStatus.serverCommit && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            serving Nostr commit{" "}
            <code className="bg-muted px-1 rounded">
              {serverStatus.serverCommit.slice(0, 8)}
            </code>
            {stateCreatedAt && (
              <span>
                {" "}
                ({safeFormatDistanceToNow(stateCreatedAt, { addSuffix: true })})
              </span>
            )}{" "}
            · another server has unannounced commits
          </p>
        )}

        {/* Normal "behind" case — server is missing commits the Nostr state has */}
        {serverStatus.status === "behind" &&
          !gitIsAhead &&
          serverStatus.serverCommit && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              has{" "}
              <code className="bg-muted px-1 rounded">
                {serverStatus.serverCommit.slice(0, 8)}
              </code>
              {hasState && serverStatus.expectedCommit && (
                <span className="text-muted-foreground/70">
                  {" "}
                  · signed{" "}
                  <code className="bg-muted px-1 rounded">
                    {serverStatus.expectedCommit.slice(0, 8)}
                  </code>
                  {stateCreatedAt && (
                    <span>
                      {" "}
                      (
                      {safeFormatDistanceToNow(stateCreatedAt, {
                        addSuffix: true,
                      })}
                      )
                    </span>
                  )}
                </span>
              )}
            </p>
          )}

        {serverStatus.status === "error" && (
          <ErrorDetail
            errorKind={serverStatus.errorKind}
            usesProxy={serverStatus.usesProxy}
          />
        )}
        {serverStatus.status === "connected" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            reachable — waiting for state…
          </p>
        )}
        {serverStatus.status === "unknown" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">fetching…</p>
        )}
      </div>

      {serverStatus.usesProxy && <ProxyBadge />}
      <span
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground mt-0.5"
        aria-hidden
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </span>
      <ServerStatusLabel
        status={serverStatus.status}
        hasState={hasState}
        gitIsAhead={gitIsAhead}
        refinedBehindLabel={refinedBehindLabel}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cross-ref discrepancy section
// ---------------------------------------------------------------------------

function CrossRefDiscrepancies({
  discrepancies,
  urlStates,
}: {
  discrepancies: RefDiscrepancy[];
  urlStates: Record<string, UrlState>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());

  if (discrepancies.length === 0) return null;

  const toggleRef = (refName: string) => {
    setExpandedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(refName)) {
        next.delete(refName);
      } else {
        next.add(refName);
      }
      return next;
    });
  };

  return (
    <>
      <Separator />
      <div className="px-4 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-500 transition-colors w-full"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="font-medium">
            {discrepancies.length === 1
              ? "1 other ref differs across servers"
              : `${discrepancies.length} other refs differ across servers`}
          </span>
          {expanded ? (
            <ChevronUp className="h-3 w-3 ml-auto shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
          )}
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {discrepancies.map((d) => {
              const isRefExpanded = expandedRefs.has(d.refName);
              // Short display name for the ref
              const shortRef = d.refName
                .replace(/^refs\/heads\//, "")
                .replace(/^refs\/tags\//, "tag: ")
                .replace(/^refs\//, "");

              return (
                <div key={d.refName} className="pl-4">
                  {/* Ref header row — clickable to expand server detail */}
                  <button
                    onClick={() => toggleRef(d.refName)}
                    className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] shrink-0">
                      {shortRef}
                    </code>
                    <span className="text-amber-600/80 dark:text-amber-400/70">
                      {d.disagreeCount}/{d.totalServers} server
                      {d.disagreeCount !== 1 ? "s" : ""} differ
                    </span>
                    {isRefExpanded ? (
                      <ChevronUp className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
                    ) : (
                      <ChevronDown className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
                    )}
                  </button>

                  {/* Per-server breakdown */}
                  {isRefExpanded && d.servers.length > 0 && (
                    <div className="mt-1.5 ml-2 space-y-1 border-l border-border/40 pl-3">
                      {d.expectedCommit && (
                        <p className="text-[10px] text-muted-foreground/60 mb-1">
                          expected:{" "}
                          <code className="font-mono bg-muted px-1 rounded">
                            {d.expectedCommit.slice(0, 8)}
                          </code>
                        </p>
                      )}
                      {d.servers.map((srv) => {
                        const urlState = urlStates[srv.url];
                        const lastSuccess = urlState?.lastSuccessAt;
                        return (
                          <div
                            key={srv.url}
                            className="flex items-center gap-1.5 text-[10px]"
                          >
                            {srv.matches ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3 w-3 text-amber-500 shrink-0" />
                            )}
                            <span
                              className="font-mono text-muted-foreground truncate min-w-0"
                              title={srv.url}
                            >
                              {shortLabel(srv.url)}
                            </span>
                            <code className="font-mono bg-muted px-1 rounded shrink-0">
                              {srv.commit.slice(0, 8)}
                            </code>
                            {lastSuccess && (
                              <span className="text-muted-foreground/50 shrink-0">
                                · checked{" "}
                                {safeFormatDistanceToNow(
                                  Math.floor(lastSuccess / 1000),
                                  { addSuffix: true },
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function GitServerPanel({
  serverStatuses,
  hasState,
  noState,
  currentRefShort,
  graspCloneUrls,
  additionalGitServerUrls,
  crossRefDiscrepancies,
  urlStates,
  gitIsAhead,
  stateCreatedAt,
  gitCommitterDate,
  pool,
}: {
  serverStatuses: ServerStatus[];
  hasState: boolean;
  noState: boolean;
  currentRefShort: string;
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  crossRefDiscrepancies: RefDiscrepancy[];
  urlStates: Record<string, UrlState>;
  gitIsAhead: boolean;
  stateCreatedAt?: number;
  gitCommitterDate?: number;
  pool?: GitGraspPool | null;
}) {
  const usesGrasp = graspCloneUrls.length > 0;

  const graspStatuses = useMemo(
    () => serverStatuses.filter((s) => graspCloneUrls.includes(s.url)),
    [serverStatuses, graspCloneUrls],
  );

  const additionalStatuses = useMemo(
    () => serverStatuses.filter((s) => additionalGitServerUrls.includes(s.url)),
    [serverStatuses, additionalGitServerUrls],
  );

  const uniqueServerCount = serverStatuses.length;
  const matchingServerCount = serverStatuses.filter(
    (s) => s.status === "match",
  ).length;

  return (
    <div className="w-full p-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          {usesGrasp && (
            <GraspLogo className="h-4 w-4 shrink-0 text-pink-500" />
          )}
          <p className="text-sm font-semibold text-foreground">
            {!usesGrasp
              ? "Git Servers"
              : additionalGitServerUrls.length === 0
                ? "Grasp Servers"
                : "Grasp & Git Servers"}
          </p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {hasState && gitIsAhead ? (
            // Git server is ahead of Nostr state — reframe the summary
            <span className="text-amber-600/90 dark:text-amber-400/80">
              At least one server has commits not yet announced on Nostr for{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">
                {currentRefShort}
              </code>
            </span>
          ) : hasState ? (
            <>
              <span className="font-medium text-foreground">
                {matchingServerCount}/{uniqueServerCount}
              </span>{" "}
              {uniqueServerCount === 1 ? "server" : "servers"} serving the Nostr
              state for{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">
                {currentRefShort}
              </code>
            </>
          ) : noState ? (
            <>
              Comparing {uniqueServerCount} server
              {uniqueServerCount !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              Checking {uniqueServerCount} server
              {uniqueServerCount !== 1 ? "s" : ""}…
            </>
          )}
        </p>
      </div>

      <ScrollArea className="max-h-[400px]">
        {/* Grasp servers */}
        {usesGrasp && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <GraspLogo className="h-3 w-3 text-pink-500" />
              Grasp Servers
            </div>
            {graspStatuses.map((s) => (
              <ServerRow
                key={s.url}
                serverStatus={s}
                hasState={hasState}
                isGrasp={true}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
              />
            ))}
          </div>
        )}

        {/* Separator between sections */}
        {usesGrasp && additionalStatuses.length > 0 && <Separator />}

        {/* Other git servers */}
        {additionalStatuses.length > 0 && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Server className="h-3 w-3" />
              Other Git Servers
            </div>
            {additionalStatuses.map((s) => (
              <ServerRow
                key={s.url}
                serverStatus={s}
                hasState={hasState}
                isGrasp={false}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Cross-ref discrepancies — computed by the pool */}
      <CrossRefDiscrepancies
        discrepancies={crossRefDiscrepancies}
        urlStates={urlStates}
      />

      {/* Footer note */}
      {noState && (
        <>
          <Separator />
          <div className="px-4 py-2.5 text-[11px] text-muted-foreground/70 leading-relaxed">
            No Nostr state — comparing git servers to each other
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — trigger button + popover
// ---------------------------------------------------------------------------

export function GitServerStatus({
  currentRefFull,
  currentRefShort,
  repoRelayEose,
  hasStateEvent,
  urlStates,
  cloneUrls,
  graspCloneUrls,
  additionalGitServerUrls,
  crossRefDiscrepancies,
  poolWarning,
  stateCreatedAt,
  pool,
}: GitServerStatusProps) {
  const [open, setOpen] = useState(false);

  // Build per-server statuses from pool-computed data — no ref comparison here
  const serverStatuses = useMemo(
    () => buildServerStatuses(currentRefFull, urlStates, cloneUrls),
    [currentRefFull, urlStates, cloneUrls],
  );

  const hasState = hasStateEvent && repoRelayEose;
  const noState = repoRelayEose && !hasStateEvent;

  // Detect when a git server is confirmed ahead of the signed state
  const gitIsAhead = poolWarning?.kind === "state-behind-git";
  const gitCommitterDate =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitCommitterDate
      : undefined;

  const uniqueServerCount = cloneUrls.length;
  const matchingUniqueCount = serverStatuses.filter(
    (s) => s.status === "match",
  ).length;
  const hasConfirmedProblem = serverStatuses.some(
    (s) =>
      s.status === "behind" || s.status === "ahead" || s.status === "error",
  );

  // Build statuses array for the icon — one entry per URL
  const iconStatuses = useMemo(
    () => serverStatuses.map((s) => s.status),
    [serverStatuses],
  );

  if (cloneUrls.length === 0) return null;

  const allMatch =
    matchingUniqueCount === uniqueServerCount && uniqueServerCount > 0;
  // Only go amber when there is a confirmed problem (behind/ahead/error),
  // not merely because some servers are still fetching ("unknown").
  const someMatch = matchingUniqueCount > 0 && !hasConfirmedProblem;
  const hasProblems = hasConfirmedProblem;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-2 rounded-md border text-[11px] transition-all duration-200",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            allMatch || someMatch
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
              : hasProblems
                ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                : "border-border/60 text-muted-foreground",
          )}
          aria-label="Git server status"
        >
          <GitServerStatusIcon statuses={iconStatuses} className="h-4 w-4" />
          <span className="font-medium tabular-nums">
            {matchingUniqueCount}/{uniqueServerCount}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0 overflow-hidden w-[560px]"
        align="end"
        sideOffset={6}
      >
        <GitServerPanel
          serverStatuses={serverStatuses}
          hasState={hasState}
          noState={noState}
          currentRefShort={currentRefShort}
          graspCloneUrls={graspCloneUrls}
          additionalGitServerUrls={additionalGitServerUrls}
          crossRefDiscrepancies={crossRefDiscrepancies}
          urlStates={urlStates}
          gitIsAhead={gitIsAhead}
          stateCreatedAt={stateCreatedAt}
          gitCommitterDate={gitCommitterDate}
          pool={pool}
        />
      </PopoverContent>
    </Popover>
  );
}
