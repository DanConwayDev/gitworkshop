import React, { useState, useMemo } from "react";
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
import { cn } from "@/lib/utils";
import { GraspLogo } from "@/components/GraspLogo";
import { GitServerStatusIcon } from "@/components/GitServerStatusIcon";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { graspCloneUrlNpub } from "@/lib/nip34";
import type {
  UrlState,
  UrlRefStatus,
  UrlErrorKind,
  RefDiscrepancy,
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

function ServerStatusDot({ status }: { status: UrlRefStatus }) {
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "behind":
      return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "ahead":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    case "connected":
      return (
        <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
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
}: {
  status: UrlRefStatus;
  hasState: boolean;
}) {
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
          {hasState ? "out of sync" : "differs"}
        </span>
      );
    case "ahead":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          ahead
        </span>
      );
    case "error":
      return <span className="text-[10px] text-red-500 shrink-0">error</span>;
    case "connected":
      return (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          ok
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

  return <p className="text-[11px] text-red-500/80 mt-0.5">{message}</p>;
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
}: {
  serverStatus: ServerStatus;
  hasState: boolean;
  isGrasp: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div className="flex items-start gap-2.5 px-4 py-2 text-xs group hover:bg-accent/30 transition-colors">
      <ServerStatusDot status={serverStatus.status} />

      <div className="min-w-0 flex-1">
        {/* URL line */}
        <p
          className="font-mono text-foreground/80 break-all leading-snug"
          title={serverStatus.url}
        >
          {displayUrl}
        </p>

        {/* Grasp owner identity */}
        {isGrasp && (
          <div className="flex items-center gap-1.5 mt-1">
            {pubkey ? (
              <>
                <UserAvatar
                  pubkey={pubkey}
                  size="sm"
                  className="h-4 w-4 text-[7px]"
                />
                <UserName
                  pubkey={pubkey}
                  className="text-[11px] text-muted-foreground"
                />
              </>
            ) : npub ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                {condenseNpub(npub)}
              </span>
            ) : null}
          </div>
        )}

        {/* Sync status detail */}
        {serverStatus.status === "behind" && serverStatus.serverCommit && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            has{" "}
            <code className="bg-muted px-1 rounded">
              {serverStatus.serverCommit.slice(0, 8)}
            </code>
            {hasState && serverStatus.expectedCommit && (
              <>
                {" "}
                · signed{" "}
                <code className="bg-muted px-1 rounded">
                  {serverStatus.expectedCommit.slice(0, 8)}
                </code>
              </>
            )}
          </p>
        )}
        {serverStatus.status === "error" && (
          <ErrorDetail
            errorKind={serverStatus.errorKind}
            usesProxy={serverStatus.usesProxy}
          />
        )}
        {serverStatus.status === "unknown" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">fetching…</p>
        )}
      </div>

      {serverStatus.usesProxy && <ProxyBadge />}
      <button
        onClick={handleCopy}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5"
        aria-label="Copy clone URL"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      <ServerStatusLabel status={serverStatus.status} hasState={hasState} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cross-ref discrepancy section
// ---------------------------------------------------------------------------

function CrossRefDiscrepancies({
  discrepancies,
}: {
  discrepancies: RefDiscrepancy[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (discrepancies.length === 0) return null;

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
          <div className="mt-2 space-y-1">
            {discrepancies.map((d) => (
              <div
                key={d.refName}
                className="flex items-center gap-2 text-[11px] text-muted-foreground pl-4"
              >
                <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">
                  {d.refName}
                </code>
                <span>
                  {d.disagreeCount}/{d.totalServers} server
                  {d.disagreeCount !== 1 ? "s" : ""} differ
                </span>
              </div>
            ))}
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
}: {
  serverStatuses: ServerStatus[];
  hasState: boolean;
  noState: boolean;
  currentRefShort: string;
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  crossRefDiscrepancies: RefDiscrepancy[];
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
            <GraspLogo className="h-4 w-4 shrink-0 text-violet-500" />
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
          {hasState ? (
            <>
              <span className="font-medium text-foreground">
                {matchingServerCount}/{uniqueServerCount}
              </span>{" "}
              {uniqueServerCount === 1 ? "server" : "servers"} serving the
              signed state for{" "}
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
              <GraspLogo className="h-3 w-3 text-violet-500" />
              Grasp Servers
            </div>
            {graspStatuses.map((s) => (
              <ServerRow
                key={s.url}
                serverStatus={s}
                hasState={hasState}
                isGrasp={true}
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
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Cross-ref discrepancies — computed by the pool */}
      <CrossRefDiscrepancies discrepancies={crossRefDiscrepancies} />

      {/* Footer note */}
      {noState && (
        <>
          <Separator />
          <div className="px-4 py-2.5 text-[11px] text-muted-foreground/70 leading-relaxed">
            No signed state — comparing git servers to each other
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
}: GitServerStatusProps) {
  const [open, setOpen] = useState(false);

  // Build per-server statuses from pool-computed data — no ref comparison here
  const serverStatuses = useMemo(
    () => buildServerStatuses(currentRefFull, urlStates, cloneUrls),
    [currentRefFull, urlStates, cloneUrls],
  );

  const hasState = hasStateEvent && repoRelayEose;
  const noState = repoRelayEose && !hasStateEvent;

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
        />
      </PopoverContent>
    </Popover>
  );
}
