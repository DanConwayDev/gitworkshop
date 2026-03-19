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
import { graspCloneUrlDomain, graspCloneUrlNpub } from "@/lib/nip34";
import { urlUsesProxy } from "@/lib/corsProxy";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { UrlInfoRefsResult } from "@/services/gitRepoDataService";

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
// Grasp URL grouping helpers
// ---------------------------------------------------------------------------

interface GraspEndpoint {
  url: string;
  npub: string;
  pubkey: string | undefined;
  status: ServerStatus | undefined;
}

interface GraspServerGroup {
  domain: string;
  endpoints: GraspEndpoint[];
  bestStatus: ServerRefStatus;
}

function npubToPubkey(npub: string): string | undefined {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === "npub") return decoded.data;
    return undefined;
  } catch {
    return undefined;
  }
}

function groupGraspByDomain(
  graspCloneUrls: string[],
  serverStatuses: ServerStatus[],
): GraspServerGroup[] {
  const domainMap = new Map<string, GraspEndpoint[]>();

  for (const url of graspCloneUrls) {
    const domain = graspCloneUrlDomain(url) ?? "unknown";
    const npub = graspCloneUrlNpub(url) ?? "unknown";
    const pubkey = npub !== "unknown" ? npubToPubkey(npub) : undefined;
    const status = serverStatuses.find((s) => s.url === url);

    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push({ url, npub, pubkey, status });
  }

  const groups: GraspServerGroup[] = [];
  for (const [domain, endpoints] of domainMap) {
    const statusRank = (s: ServerRefStatus | undefined) => {
      if (s === "match") return 0;
      if (s === "unknown") return 1;
      if (s === "ahead" || s === "behind") return 2;
      if (s === "error") return 3;
      return 4;
    };
    const best = endpoints.reduce<ServerRefStatus>((acc, ep) => {
      const epStatus = ep.status?.status ?? "unknown";
      return statusRank(epStatus) < statusRank(acc) ? epStatus : acc;
    }, "unknown" as ServerRefStatus);
    groups.push({ domain, endpoints, bestStatus: best });
  }

  return groups;
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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleCopy}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs" sideOffset={6}>
        {copied ? "Copied!" : (label ?? "Copy clone URL")}
      </TooltipContent>
    </Tooltip>
  );
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

function GraspEndpointRow({
  endpoint,
  hasState,
}: {
  endpoint: GraspEndpoint;
  hasState: boolean;
}) {
  const viaProxy = urlUsesProxy(endpoint.url);

  return (
    <div className="flex items-center gap-2.5 px-4 pl-10 py-1.5 text-xs group hover:bg-accent/30 transition-colors">
      <ServerStatusDot status={endpoint.status?.status ?? "unknown"} />

      {/* Avatar + name for the npub */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {endpoint.pubkey ? (
          <>
            <UserAvatar
              pubkey={endpoint.pubkey}
              size="sm"
              className="h-5 w-5 text-[8px]"
            />
            <UserName
              pubkey={endpoint.pubkey}
              className="text-xs text-foreground/80 truncate"
            />
          </>
        ) : (
          <span className="font-mono text-foreground/60 truncate">
            {endpoint.npub.slice(0, 12)}…
          </span>
        )}
      </div>

      {/* Commit info */}
      {endpoint.status?.status === "behind" && endpoint.status.serverCommit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <code className="text-[10px] font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded shrink-0 cursor-default">
              {endpoint.status.serverCommit.slice(0, 7)}
            </code>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            className="text-xs max-w-[240px]"
            sideOffset={6}
          >
            Server has{" "}
            <code className="font-mono bg-muted px-1 rounded">
              {endpoint.status.serverCommit.slice(0, 8)}
            </code>
            {hasState && endpoint.status.stateCommit && (
              <>
                {" "}
                but signed state is{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  {endpoint.status.stateCommit.slice(0, 8)}
                </code>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {viaProxy && <ProxyBadge />}

      <CopyButton text={endpoint.url} />

      <ServerStatusLabel
        status={endpoint.status?.status ?? "unknown"}
        hasState={hasState}
      />
    </div>
  );
}

function GraspServerGroupRow({
  group,
  hasState,
}: {
  group: GraspServerGroup;
  hasState: boolean;
}) {
  return (
    <div className="py-2">
      {/* Server domain header */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <GraspLogo className="h-3.5 w-3.5 shrink-0 text-violet-500" />
        <span className="text-xs font-medium text-foreground">
          {group.domain}
        </span>
        <ServerStatusBadge status={group.bestStatus} hasState={hasState} />
      </div>

      {/* Maintainer endpoints */}
      <div className="space-y-0.5">
        {group.endpoints.map((ep) => (
          <GraspEndpointRow key={ep.url} endpoint={ep} hasState={hasState} />
        ))}
      </div>
    </div>
  );
}

function AdditionalServerRow({
  serverStatus,
  hasState,
}: {
  serverStatus: ServerStatus;
  hasState: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const viaProxy = urlUsesProxy(serverStatus.url);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(serverStatus.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 text-xs group hover:bg-accent/30 transition-colors">
      <ServerStatusDot status={serverStatus.status} />
      <div className="min-w-0 flex-1">
        <p
          className="font-mono text-foreground/80 truncate"
          title={serverStatus.url}
        >
          {serverStatus.label}
        </p>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs" sideOffset={6}>
          {copied ? "Copied!" : "Copy clone URL"}
        </TooltipContent>
      </Tooltip>
      <ServerStatusLabel status={serverStatus.status} hasState={hasState} />
    </div>
  );
}

function ServerStatusBadge({
  status,
  hasState,
}: {
  status: ServerRefStatus;
  hasState: boolean;
}) {
  switch (status) {
    case "match":
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 leading-none">
          <CheckCircle2 className="h-2.5 w-2.5" />
          {hasState ? "signed" : "in sync"}
        </span>
      );
    case "behind":
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 leading-none">
          <AlertTriangle className="h-2.5 w-2.5" />
          {hasState ? "out of sync" : "differs"}
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-500 border border-red-500/20 leading-none">
          <XCircle className="h-2.5 w-2.5" />
          error
        </span>
      );
    default:
      return null;
  }
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

  const graspGroups = useMemo(
    () => groupGraspByDomain(graspCloneUrls, serverStatuses),
    [graspCloneUrls, serverStatuses],
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

  // Count unique servers (domains for grasp, individual URLs for others)
  const uniqueServerCount = graspGroups.length + additionalGitServerUrls.length;
  const matchingServerCount = (() => {
    let count = 0;
    for (const g of graspGroups) {
      if (g.bestStatus === "match") count++;
    }
    for (const s of additionalStatuses) {
      if (s.status === "match") count++;
    }
    return count;
  })();

  return (
    <div className="w-[440px] p-0">
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
        {/* Clone URLs section header */}
        <div className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Clone URLs
        </div>

        {/* Grasp server groups */}
        {graspGroups.map((group) => (
          <GraspServerGroupRow
            key={group.domain}
            group={group}
            hasState={hasState}
          />
        ))}

        {/* Separator between grasp and additional servers */}
        {graspGroups.length > 0 && additionalStatuses.length > 0 && (
          <Separator />
        )}

        {/* Additional (non-grasp) git servers */}
        {additionalStatuses.length > 0 && (
          <div className="py-1">
            {graspGroups.length > 0 && (
              <div className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <Server className="h-3 w-3" />
                Other Git Servers
              </div>
            )}
            {additionalStatuses.map((s) => (
              <AdditionalServerRow
                key={s.url}
                serverStatus={s}
                hasState={hasState}
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

  // Group grasp URLs by domain for unique server counting
  const graspGroups = useMemo(
    () => groupGraspByDomain(graspCloneUrls, serverStatuses),
    [graspCloneUrls, serverStatuses],
  );

  const additionalServerStatuses = useMemo(
    () => serverStatuses.filter((s) => additionalGitServerUrls.includes(s.url)),
    [serverStatuses, additionalGitServerUrls],
  );

  // Count unique servers (domains for grasp, individual URLs for others)
  const uniqueServerCount = graspGroups.length + additionalGitServerUrls.length;
  const matchingUniqueCount = (() => {
    let count = 0;
    for (const g of graspGroups) {
      if (g.bestStatus === "match") count++;
    }
    for (const s of additionalServerStatuses) {
      if (s.status === "match") count++;
    }
    return count;
  })();

  // Build statuses array for the icon
  const iconStatuses = useMemo(() => {
    const statuses: (string | undefined)[] = [];
    for (const g of graspGroups) {
      statuses.push(g.bestStatus);
    }
    for (const s of additionalServerStatuses) {
      statuses.push(s.status);
    }
    return statuses;
  }, [graspGroups, additionalServerStatuses]);

  if (cloneUrls.length === 0) return null;

  const allMatch =
    matchingUniqueCount === uniqueServerCount && uniqueServerCount > 0;
  const someMatch = matchingUniqueCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-2 rounded-md border text-[11px] transition-all duration-200",
                "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                allMatch
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                  : someMatch
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                    : "border-border/60 text-muted-foreground",
              )}
              aria-label="Git server status"
            >
              <GitServerStatusIcon
                statuses={iconStatuses}
                className="h-4 w-4"
              />
              <span className="font-medium tabular-nums">
                {matchingUniqueCount}/{uniqueServerCount}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="text-xs max-w-[260px]"
          sideOffset={6}
        >
          <ServerStatusTooltip
            graspTotal={graspGroups.length}
            graspMatch={
              graspGroups.filter((g) => g.bestStatus === "match").length
            }
            additionalTotal={additionalGitServerUrls.length}
            additionalMatch={
              additionalServerStatuses.filter((s) => s.status === "match")
                .length
            }
          />
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        className="p-0 overflow-hidden"
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

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function ServerStatusTooltip({
  graspTotal,
  graspMatch,
  additionalTotal,
  additionalMatch,
}: {
  graspTotal: number;
  graspMatch: number;
  additionalTotal: number;
  additionalMatch: number;
}) {
  const parts: React.ReactNode[] = [];

  if (graspTotal > 0) {
    const allOk = graspMatch === graspTotal;
    const outOfSync = graspTotal - graspMatch;
    parts.push(
      <span key="grasp">
        {graspTotal} Grasp server{graspTotal !== 1 ? "s" : ""}
        {!allOk && outOfSync > 0 && (
          <span className="text-amber-400"> · {outOfSync} out of sync</span>
        )}
      </span>,
    );
  }

  if (additionalTotal > 0) {
    const allOk = additionalMatch === additionalTotal;
    const outOfSync = additionalTotal - additionalMatch;
    parts.push(
      <span key="additional">
        {additionalTotal} additional git server
        {additionalTotal !== 1 ? "s" : ""}
        {!allOk && outOfSync > 0 && (
          <span className="text-amber-400"> · {outOfSync} out of sync</span>
        )}
      </span>,
    );
  }

  if (parts.length === 0) {
    return <span>No git servers configured</span>;
  }

  return (
    <span>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground">, </span>}
          {part}
        </span>
      ))}
    </span>
  );
}
