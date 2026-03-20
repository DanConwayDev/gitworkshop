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
import { urlUsesProxy } from "@/lib/corsProxy";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { UrlInfoRefsResult } from "@/hooks/useGitRepoData";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitServerStatusProps {
  /** Currently selected ref name */
  currentRef: string;
  /** All known refs */
  refs: GitRef[];
  /** The winning Nostr state event, null if none found, undefined while loading */
  repoState: RepositoryState | null | undefined;
  /** True once the relay EOSE has been received for the state query */
  repoRelayEose: boolean;
  /** Per-URL infoRefs results from the git data service */
  urlInfoRefs?: Record<string, UrlInfoRefsResult>;
  /** All clone URLs for this repo */
  cloneUrls?: string[];
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls?: string[];
  /** Subset of cloneUrls that are NOT Grasp server clone URLs */
  additionalGitServerUrls?: string[];
}

// ---------------------------------------------------------------------------
// Per-server status helpers
// ---------------------------------------------------------------------------

/** Status of a single git server for a given ref */
type ServerRefStatus = "match" | "ahead" | "behind" | "unknown" | "error";

interface ServerStatus {
  url: string;
  /** Short display label derived from the URL */
  label: string;
  status: ServerRefStatus;
  /** The commit this server has for the ref (if known) */
  serverCommit?: string;
  /** The commit the state event declares (if known) */
  stateCommit?: string;
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
 * Compute per-server status for the currently selected ref.
 */
function computeServerStatuses(
  currentRef: string,
  currentRefObj: GitRef | undefined,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
  urlInfoRefs: Record<string, UrlInfoRefsResult>,
  cloneUrls: string[],
): ServerStatus[] {
  if (cloneUrls.length === 0) return [];

  const prefix = currentRefObj?.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = currentRefObj
    ? `${prefix}${currentRefObj.name}`
    : undefined;

  // Get the state commit for this ref (if state event exists)
  let stateCommit: string | undefined;
  if (repoState && fullRefName) {
    const stateRef = repoState.refs.find((r) => r.name === fullRefName);
    stateCommit = stateRef?.commitId;
  }

  return cloneUrls.map((url) => {
    const result = urlInfoRefs[url];
    const label = shortLabel(url);

    if (!result) {
      return { url, label, status: "unknown" };
    }

    if (result.status === "error") {
      return { url, label, status: "error" };
    }

    // Get this server's commit for the ref
    let serverCommit: string | undefined;
    if (fullRefName) {
      serverCommit = result.info.refs[fullRefName];
    }

    if (!serverCommit) {
      return { url, label, status: "unknown" };
    }

    if (repoState !== undefined && repoRelayEose) {
      if (!stateCommit) {
        return { url, label, status: "unknown", serverCommit };
      }

      const matches =
        serverCommit === stateCommit ||
        serverCommit.startsWith(stateCommit) ||
        stateCommit.startsWith(serverCommit);

      return {
        url,
        label,
        status: matches ? "match" : "behind",
        serverCommit,
        stateCommit,
      };
    }

    // No state event — compare servers to each other
    const firstResult = urlInfoRefs[cloneUrls[0]];
    const firstCommit =
      firstResult?.status === "ok" && fullRefName
        ? firstResult.info.refs[fullRefName]
        : undefined;

    if (!firstCommit || url === cloneUrls[0]) {
      return { url, label, status: "match", serverCommit };
    }

    const matches =
      serverCommit === firstCommit ||
      serverCommit.startsWith(firstCommit) ||
      firstCommit.startsWith(serverCommit);

    return {
      url,
      label,
      status: matches ? "match" : "behind",
      serverCommit,
      stateCommit: firstCommit,
    };
  });
}

// ---------------------------------------------------------------------------
// Cross-ref discrepancy detection
// ---------------------------------------------------------------------------

interface RefDiscrepancy {
  refName: string;
  /** Number of servers that disagree with the majority/state commit */
  disagreeCount: number;
  totalServers: number;
}

/**
 * Detect discrepancies across ALL refs (not just the current one).
 * Compares each server's info/refs data against the state event or majority.
 */
function detectCrossRefDiscrepancies(
  currentRef: string,
  refs: GitRef[],
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
  urlInfoRefs: Record<string, UrlInfoRefsResult>,
  cloneUrls: string[],
): RefDiscrepancy[] {
  if (cloneUrls.length < 2) return [];

  const okResults = cloneUrls
    .map((url) => ({ url, result: urlInfoRefs[url] }))
    .filter(
      (
        r,
      ): r is {
        url: string;
        result: Extract<UrlInfoRefsResult, { status: "ok" }>;
      } => r.result?.status === "ok",
    );

  if (okResults.length < 2) return [];

  const discrepancies: RefDiscrepancy[] = [];

  for (const ref of refs) {
    // Skip the current ref — it's already shown in the main status
    if (ref.name === currentRef) continue;

    const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
    const fullRefName = `${prefix}${ref.name}`;

    // Get the "expected" commit: from state event, or from the first server
    let expectedCommit: string | undefined;
    if (repoState && repoRelayEose) {
      const stateRef = repoState.refs.find((r) => r.name === fullRefName);
      expectedCommit = stateRef?.commitId;
    }

    // Collect commits from each server
    const serverCommits = okResults
      .map((r) => r.result.info.refs[fullRefName])
      .filter(Boolean);

    if (serverCommits.length < 2) continue;

    if (!expectedCommit) {
      // No state — use majority
      expectedCommit = serverCommits[0];
    }

    const disagreeCount = serverCommits.filter((c) => {
      return (
        c !== expectedCommit &&
        !c.startsWith(expectedCommit!) &&
        !expectedCommit!.startsWith(c)
      );
    }).length;

    if (disagreeCount > 0) {
      discrepancies.push({
        refName: ref.name,
        disagreeCount,
        totalServers: serverCommits.length,
      });
    }
  }

  return discrepancies;
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
 * e.g. https://grasp.io/npub1abc...xyz/repo.git → https://grasp.io/npub1ab…yz/repo.git
 */
function condenseGraspUrl(url: string): string {
  const npub = graspCloneUrlNpub(url);
  if (!npub) return url;
  return url.replace(npub, condenseNpub(npub));
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ServerStatusDot({ status }: { status: ServerRefStatus }) {
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case "behind":
      return <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "ahead":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
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
  status: ServerRefStatus;
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
  const viaProxy = urlUsesProxy(serverStatus.url);

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
        {serverStatus.status === "behind" &&
          serverStatus.serverCommit &&
          serverStatus.stateCommit && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              has{" "}
              <code className="bg-muted px-1 rounded">
                {serverStatus.serverCommit.slice(0, 8)}
              </code>
              {hasState && (
                <>
                  {" "}
                  · signed{" "}
                  <code className="bg-muted px-1 rounded">
                    {serverStatus.stateCommit.slice(0, 8)}
                  </code>
                </>
              )}
            </p>
          )}
        {serverStatus.status === "error" && (
          <p className="text-[11px] text-red-500/80 mt-0.5">unreachable</p>
        )}
        {serverStatus.status === "unknown" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">fetching…</p>
        )}
      </div>

      {viaProxy && <ProxyBadge />}
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
  repoState,
  repoRelayEose,
  currentRef,
  refs,
  graspCloneUrls,
  additionalGitServerUrls,
  urlInfoRefs,
  cloneUrls,
}: {
  serverStatuses: ServerStatus[];
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  currentRef: string;
  refs: GitRef[];
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  urlInfoRefs: Record<string, UrlInfoRefsResult>;
  cloneUrls: string[];
}) {
  const hasState =
    repoState !== null && repoState !== undefined && repoRelayEose;
  const noState = repoRelayEose && repoState === null;
  const usesGrasp = graspCloneUrls.length > 0;

  const graspStatuses = useMemo(
    () => serverStatuses.filter((s) => graspCloneUrls.includes(s.url)),
    [serverStatuses, graspCloneUrls],
  );

  const additionalStatuses = useMemo(
    () => serverStatuses.filter((s) => additionalGitServerUrls.includes(s.url)),
    [serverStatuses, additionalGitServerUrls],
  );

  const crossRefDiscrepancies = useMemo(
    () =>
      detectCrossRefDiscrepancies(
        currentRef,
        refs,
        repoState,
        repoRelayEose,
        urlInfoRefs,
        cloneUrls,
      ),
    [currentRef, refs, repoState, repoRelayEose, urlInfoRefs, cloneUrls],
  );

  const uniqueServerCount = cloneUrls.length;
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
                {currentRef}
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

      {/* Cross-ref discrepancies */}
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
  currentRef,
  refs,
  repoState,
  repoRelayEose,
  urlInfoRefs = {},
  cloneUrls = [],
  graspCloneUrls = [],
  additionalGitServerUrls = [],
}: GitServerStatusProps) {
  const [open, setOpen] = useState(false);

  const currentRefObj = refs.find((r) => r.name === currentRef);

  // Per-server statuses for the current ref
  const serverStatuses = useMemo(
    () =>
      computeServerStatuses(
        currentRef,
        currentRefObj,
        repoState,
        repoRelayEose,
        urlInfoRefs,
        cloneUrls,
      ),
    [
      currentRef,
      currentRefObj,
      repoState,
      repoRelayEose,
      urlInfoRefs,
      cloneUrls,
    ],
  );

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
          repoState={repoState}
          repoRelayEose={repoRelayEose}
          currentRef={currentRef}
          refs={refs}
          graspCloneUrls={graspCloneUrls}
          additionalGitServerUrls={additionalGitServerUrls}
          urlInfoRefs={urlInfoRefs}
          cloneUrls={cloneUrls}
        />
      </PopoverContent>
    </Popover>
  );
}
