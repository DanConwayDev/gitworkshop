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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GitBranch,
  Tag,
  Check,
  ChevronsUpDown,
  Search,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GraspLogo } from "@/components/GraspLogo";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { UrlInfoRefsResult } from "@/services/gitRepoDataService";
import { urlUsesProxy } from "@/lib/corsProxy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefSelectorProps {
  refs: GitRef[];
  currentRef: string;
  onRefChange: (ref: string) => void;
  /** The winning Nostr state event, null if none found, undefined while loading */
  repoState: RepositoryState | null | undefined;
  /** True once the relay EOSE has been received for the state query */
  repoRelayEose: boolean;
  /** True while data is still being fetched */
  loading?: boolean;
  /** Per-URL infoRefs results from the git data service */
  urlInfoRefs?: Record<string, UrlInfoRefsResult>;
  /** All clone URLs for this repo */
  cloneUrls?: string[];
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls?: string[];
  /** Subset of cloneUrls that are NOT Grasp server clone URLs */
  additionalGitServerUrls?: string[];
}

/**
 * Status of a ref's verification against the signed state event.
 *
 * - "verified"        : state event exists and this ref's commit matches
 * - "mismatch"        : state event exists but declares a different commit for this ref
 * - "git-server-only" : state event exists but doesn't include this ref
 * - "no-state"        : no state event was found (after EOSE)
 * - "loading"         : still waiting for state event data
 */
type RefStatus =
  | "verified"
  | "mismatch"
  | "git-server-only"
  | "no-state"
  | "loading";

interface RefWithStatus extends GitRef {
  status: RefStatus;
  stateCommit?: string; // commit declared by state event (if different)
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
 *
 * When a state event exists: compare each server's commit to the state commit.
 * When no state event: compare each server's commit to the majority/first.
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
      // We have a definitive state event answer
      if (!stateCommit) {
        // Ref not in state event — server has it but state doesn't
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
    // Use the first server's commit as the reference
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

/** How many servers are serving the correct (state-matching) commit */
function countMatchingServers(statuses: ServerStatus[]): number {
  return statuses.filter((s) => s.status === "match").length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRefStatus(
  ref: GitRef,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
): { status: RefStatus; stateCommit?: string } {
  // Still loading state event data
  if (repoState === undefined || !repoRelayEose) {
    return { status: "loading" };
  }

  // No state event found
  if (repoState === null) {
    return { status: "no-state" };
  }

  // Find this ref in the state event
  const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${ref.name}`;
  const stateRef = repoState.refs.find((r) => r.name === fullRefName);

  if (!stateRef) {
    return { status: "git-server-only" };
  }

  // Compare commits (handle both full and abbreviated hashes)
  if (
    ref.hash === stateRef.commitId ||
    ref.hash.startsWith(stateRef.commitId) ||
    stateRef.commitId.startsWith(ref.hash)
  ) {
    return { status: "verified" };
  }

  return { status: "mismatch", stateCommit: stateRef.commitId };
}

function countMismatches(refsWithStatus: RefWithStatus[]): number {
  return refsWithStatus.filter((r) => r.status === "mismatch").length;
}

// ---------------------------------------------------------------------------
// Dynamic git-server icon (inspired by gitworkshop's ExplorerServerStatusIcon)
// ---------------------------------------------------------------------------

type LightState = "success" | "warning" | "error" | undefined;

/**
 * Stacked-server SVG with up to 3 status lights.
 * Each light corresponds to one git server (sorted: success → warning → error).
 */
function GitServerIcon({
  statuses,
  className,
}: {
  statuses: ServerStatus[];
  className?: string;
}) {
  // Map server statuses to light states
  const lights: LightState[] = statuses.map((s) => {
    if (s.status === "match") return "success";
    if (s.status === "unknown") return "warning";
    if (s.status === "error") return "error";
    if (s.status === "behind" || s.status === "ahead") return "warning";
    return undefined;
  });

  // Sort: success first, then warning, then error
  lights.sort((a, b) => {
    const rank = (v: LightState) =>
      v === "success" ? 0 : v === "warning" ? 1 : v === "error" ? 2 : 3;
    return rank(a) - rank(b);
  });

  // Trim to at most 3, removing duplicates of the least-important first
  while (lights.length > 3) {
    const lastError = lights.lastIndexOf("error");
    if (lastError !== -1 && lights.filter((l) => l === "error").length > 1) {
      lights.splice(lastError, 1);
      continue;
    }
    const lastWarning = lights.lastIndexOf("warning");
    if (
      lastWarning !== -1 &&
      lights.filter((l) => l === "warning").length > 1
    ) {
      lights.splice(lastWarning, 1);
      continue;
    }
    lights.splice(lights.lastIndexOf("success"), 1);
  }

  // Pad to 3
  while (lights.length < 3) lights.push(undefined);

  const colorClass = (state: LightState) => {
    if (state === "success") return "fill-emerald-500";
    if (state === "warning") return "fill-amber-500";
    if (state === "error") return "fill-red-500";
    return "";
  };

  const renderLights = (state: LightState, y: number) => {
    if (!state) return null;
    return (
      <>
        <rect x="12" y={y} width="2" height="2" className={colorClass(state)} />
        <rect x="16" y={y} width="2" height="2" className={colorClass(state)} />
      </>
    );
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      className={cn("inline", className)}
      aria-hidden="true"
    >
      {/* Stacked server chassis */}
      <path
        className="fill-current opacity-40"
        d="M0 2C0 .9.9 0 2 0h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm0 7c0-1.1.9-2 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zM12 2v2h2V2zm4 0v2h2V2zm-4 7v2h2V9zm4 0v2h2V9zm-4 7v2h2v-2zm4 0v2h2v-2z"
      />
      {/* Status lights */}
      {renderLights(lights[0], 2)}
      {renderLights(lights[1], 9)}
      {renderLights(lights[2], 16)}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Git server popover panel
// ---------------------------------------------------------------------------

function GitServerPanel({
  serverStatuses,
  repoState,
  repoRelayEose,
  currentRef,
  matchingCount,
  totalCount,
  graspCloneUrls,
  additionalGitServerUrls,
}: {
  serverStatuses: ServerStatus[];
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  currentRef: string;
  matchingCount: number;
  totalCount: number;
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
}) {
  const hasState =
    repoState !== null && repoState !== undefined && repoRelayEose;
  const noState = repoRelayEose && repoState === null;
  const usesGrasp = graspCloneUrls.length > 0;

  // Build a human-readable header title
  const headerTitle = (() => {
    if (!usesGrasp) return "Git Servers";
    if (additionalGitServerUrls.length === 0) return "Grasp Servers";
    return "Grasp & Git Servers";
  })();

  return (
    <div className="w-[300px] p-0">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          {usesGrasp && <GraspLogo className="h-3.5 w-3.5 shrink-0" />}
          <p className="text-xs font-semibold text-foreground">{headerTitle}</p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {hasState ? (
            <>
              <span className="font-medium text-foreground">
                {matchingCount}/{totalCount}
              </span>{" "}
              serving the signed state for{" "}
              <code className="font-mono bg-muted px-1 rounded">
                {currentRef}
              </code>
            </>
          ) : noState ? (
            <>
              Comparing {totalCount} git server{totalCount !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              Checking {totalCount} git server{totalCount !== 1 ? "s" : ""}…
            </>
          )}
        </p>
      </div>

      {/* Per-server rows */}
      <div className="py-1">
        {serverStatuses.map((s) => {
          const viaProxy = urlUsesProxy(s.url);
          const isGrasp = graspCloneUrls.includes(s.url);
          return (
            <div
              key={s.url}
              className="flex items-start gap-2.5 px-3 py-2 text-xs"
            >
              <ServerStatusDot status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p
                    className="font-mono truncate text-foreground/80"
                    title={s.url}
                  >
                    {s.label}
                  </p>
                  {isGrasp &&
                    usesGrasp &&
                    additionalGitServerUrls.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 cursor-default leading-none">
                            <GraspLogo className="h-2.5 w-2.5" />
                            grasp
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="text-xs max-w-[220px]"
                          sideOffset={6}
                        >
                          Hosted on a Grasp server
                        </TooltipContent>
                      </Tooltip>
                    )}
                  {viaProxy && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 cursor-default leading-none">
                          proxy
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="text-xs max-w-[220px]"
                        sideOffset={6}
                      >
                        Fetched via cors.isomorphic-git.org — this server does
                        not support cross-origin requests
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {s.status === "behind" && s.serverCommit && s.stateCommit && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    has{" "}
                    <code className="bg-muted px-1 rounded">
                      {s.serverCommit.slice(0, 8)}
                    </code>
                    {hasState && (
                      <>
                        {" "}
                        · signed{" "}
                        <code className="bg-muted px-1 rounded">
                          {s.stateCommit.slice(0, 8)}
                        </code>
                      </>
                    )}
                  </p>
                )}
                {s.status === "match" && s.serverCommit && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    <code className="bg-muted px-1 rounded">
                      {s.serverCommit.slice(0, 8)}
                    </code>
                  </p>
                )}
                {s.status === "error" && (
                  <p className="text-[11px] text-red-500/80 mt-0.5">
                    unreachable
                  </p>
                )}
                {s.status === "unknown" && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    fetching…
                  </p>
                )}
              </div>
              <ServerStatusLabel status={s.status} hasState={hasState} />
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      {noState && (
        <>
          <Separator />
          <div className="px-3 py-2 text-[11px] text-muted-foreground/70 leading-relaxed">
            No signed state — comparing git servers to each other
          </div>
        </>
      )}
    </div>
  );
}

function ServerStatusDot({ status }: { status: ServerRefStatus }) {
  switch (status) {
    case "match":
      return (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
      );
    case "behind":
      return <XCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />;
    case "ahead":
      return (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
      );
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />;
    case "unknown":
      return (
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50 mt-0.5 shrink-0" />
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
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
          {hasState ? "signed" : "in sync"}
        </span>
      );
    case "behind":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
          {hasState ? "out of sync" : "differs"}
        </span>
      );
    case "ahead":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
          ahead
        </span>
      );
    case "error":
      return (
        <span className="text-[10px] text-red-500 shrink-0 mt-0.5">error</span>
      );
    case "unknown":
      return (
        <span className="text-[10px] text-muted-foreground/50 shrink-0 mt-0.5">
          …
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Server status tooltip
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable tooltip summarising how many Grasp servers and
 * additional git servers are serving the signed state for the current ref.
 *
 * Examples:
 *   "3 Grasp servers, 1 additional git server"
 *   "2 Grasp servers · 1 out of sync, 1 additional git server · out of sync"
 *   "1 additional git server"
 */
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({
  status,
  className,
}: {
  status: RefStatus;
  className?: string;
}) {
  switch (status) {
    case "verified":
      return (
        <ShieldCheck
          className={cn("h-3.5 w-3.5 text-emerald-500", className)}
        />
      );
    case "mismatch":
      return (
        <ShieldAlert className={cn("h-3.5 w-3.5 text-amber-500", className)} />
      );
    case "git-server-only":
      return (
        <ShieldQuestion
          className={cn("h-3.5 w-3.5 text-muted-foreground/50", className)}
        />
      );
    case "no-state":
      return null;
    case "loading":
      return null;
  }
}

function StatusTooltipText({
  refWithStatus,
}: {
  refWithStatus: RefWithStatus;
}) {
  switch (refWithStatus.status) {
    case "verified":
      return (
        <span>
          Signed and verified — the maintainer's published state matches this
          git server
        </span>
      );
    case "mismatch":
      return (
        <div className="space-y-1">
          <p className="font-medium text-amber-400">Out of sync</p>
          <p>
            The maintainer signed{" "}
            <code className="font-mono text-[11px] bg-amber-500/20 px-1 rounded">
              {refWithStatus.stateCommit?.slice(0, 8)}
            </code>{" "}
            but the git server has{" "}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">
              {refWithStatus.hash.slice(0, 8)}
            </code>
          </p>
          <p className="text-muted-foreground text-[11px]">
            This could mean a push hasn't been signed yet, or the git server was
            updated without the maintainer's knowledge.
          </p>
        </div>
      );
    case "git-server-only":
      return (
        <span>
          This ref exists on the git server but isn't tracked in the
          maintainer's signed state
        </span>
      );
    case "no-state":
      return null;
    case "loading":
      return <span>Checking verification status…</span>;
  }
}

function RefRow({
  refWithStatus,
  isSelected,
  onSelect,
}: {
  refWithStatus: RefWithStatus;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const showTooltip =
    refWithStatus.status !== "no-state" && refWithStatus.status !== "loading";

  const row = (
    <button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm rounded-md transition-all duration-150",
        "hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isSelected && "bg-accent",
        refWithStatus.status === "mismatch" &&
          "hover:bg-amber-500/10 dark:hover:bg-amber-500/10",
      )}
    >
      {/* Selection check */}
      <div className="w-4 shrink-0">
        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
      </div>

      {/* Ref name */}
      <span
        className={cn(
          "flex-1 truncate font-mono text-[13px]",
          isSelected && "font-medium",
          refWithStatus.status === "mismatch" &&
            "text-amber-600 dark:text-amber-400",
        )}
        title={refWithStatus.name}
      >
        {refWithStatus.name}
      </span>

      {/* Default badge */}
      {refWithStatus.isDefault && (
        <Badge
          variant="secondary"
          className="text-[10px] h-4 px-1.5 shrink-0 font-normal"
        >
          default
        </Badge>
      )}

      {/* Status icon */}
      <StatusIcon status={refWithStatus.status} className="shrink-0" />
    </button>
  );

  if (showTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-[280px] text-xs"
          sideOffset={8}
        >
          <StatusTooltipText refWithStatus={refWithStatus} />
        </TooltipContent>
      </Tooltip>
    );
  }

  return row;
}

function MismatchBanner({ mismatchCount }: { mismatchCount: number }) {
  return (
    <div className="mx-2 mb-1 mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {mismatchCount === 1
              ? "1 ref is out of sync"
              : `${mismatchCount} refs are out of sync`}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The git server and the maintainer's signed state don't agree on{" "}
            {mismatchCount === 1 ? "a ref" : "some refs"}. This could mean a
            recent push hasn't been signed yet.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoStateBanner() {
  return (
    <div className="mx-2 mb-1 mt-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            No signed state published
          </p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            The maintainer hasn't published a signed snapshot of this repo's
            branches yet. Showing git server data only.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RefSelector({
  refs,
  currentRef,
  onRefChange,
  repoState,
  repoRelayEose,
  loading,
  urlInfoRefs = {},
  cloneUrls = [],
  graspCloneUrls = [],
  additionalGitServerUrls = [],
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [serverPanelOpen, setServerPanelOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Compute status for each ref
  const refsWithStatus: RefWithStatus[] = useMemo(
    () =>
      refs.map((ref) => ({
        ...ref,
        ...getRefStatus(ref, repoState, repoRelayEose),
      })),
    [refs, repoState, repoRelayEose],
  );

  // Split into branches and tags
  const branches = useMemo(
    () => refsWithStatus.filter((r) => r.isBranch),
    [refsWithStatus],
  );
  const tags = useMemo(
    () => refsWithStatus.filter((r) => r.isTag),
    [refsWithStatus],
  );

  // Filter by search
  const lowerSearch = search.toLowerCase();
  const filteredBranches = search
    ? branches.filter((b) => b.name.toLowerCase().includes(lowerSearch))
    : branches;
  const filteredTags = search
    ? tags.filter((t) => t.name.toLowerCase().includes(lowerSearch))
    : tags;

  const mismatchCount = countMismatches(refsWithStatus);
  const isNoState = repoRelayEose && repoState === null;

  // Hide search when all refs fit comfortably in the dropdown
  const totalRefs = branches.length + tags.length;
  const showSearch = totalRefs > 8;

  // Determine if the current ref is a tag and its verification status
  const currentRefObj = refs.find((r) => r.name === currentRef);
  const currentIsTag = currentRefObj?.isTag ?? false;
  const currentRefWithStatus = refsWithStatus.find(
    (r) => r.name === currentRef,
  );
  const currentStatus = currentRefWithStatus?.status ?? "loading";

  // Whether this repo uses Grasp (at least one Grasp clone URL declared)
  const usesGrasp = graspCloneUrls.length > 0;

  // Show the grasp status indicator in the trigger when grasp is in use and
  // we have a definitive status for the selected ref.
  const showGraspStatus =
    usesGrasp && currentStatus !== "loading" && currentStatus !== "no-state";

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

  const matchingServerCount = countMatchingServers(serverStatuses);
  const totalServerCount = cloneUrls.length;

  // Counts for the tooltip: how many Grasp servers and additional git servers
  // are in sync vs total.
  const graspServerStatuses = useMemo(
    () => serverStatuses.filter((s) => graspCloneUrls.includes(s.url)),
    [serverStatuses, graspCloneUrls],
  );
  const additionalServerStatuses = useMemo(
    () => serverStatuses.filter((s) => additionalGitServerUrls.includes(s.url)),
    [serverStatuses, additionalGitServerUrls],
  );
  const graspMatchCount = countMatchingServers(graspServerStatuses);
  const additionalMatchCount = countMatchingServers(additionalServerStatuses);

  const handleSelect = (refName: string) => {
    onRefChange(refName);
    setOpen(false);
    setSearch("");
  };

  if (loading && refs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {/* ------------------------------------------------------------------ */}
      {/* Ref selector trigger                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-all duration-200",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "max-w-[280px]",
              // Neutral border always — status colour lives on the shield icon only
              mismatchCount > 0
                ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                : "border-border/60 bg-background",
            )}
          >
            {currentIsTag ? (
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-medium">{currentRef}</span>
            {showGraspStatus ? (
              // Shield icon only — coloured to reflect status
              <span className="shrink-0 ml-0.5">
                {currentStatus === "verified" && (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                )}
                {currentStatus === "mismatch" && (
                  <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                )}
                {currentStatus === "git-server-only" && (
                  <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </span>
            ) : mismatchCount > 0 ? (
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 ml-0.5" />
            ) : null}
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60 ml-0.5" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[320px] p-0 overflow-hidden"
          align="start"
          sideOffset={6}
        >
          {/* Search input — hidden when all refs fit in the dropdown */}
          {showSearch && (
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a branch or tag…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                autoFocus
              />
            </div>
          )}

          {/* Mismatch banner */}
          {mismatchCount > 0 && (
            <MismatchBanner mismatchCount={mismatchCount} />
          )}

          {/* No state banner */}
          {isNoState && <NoStateBanner />}

          <ScrollArea className="max-h-[360px]">
            <div className="py-1">
              {/* Branches section */}
              {filteredBranches.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    <GitBranch className="h-3 w-3" />
                    Branches
                    <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
                      ({filteredBranches.length})
                    </span>
                  </div>
                  <div className="px-1">
                    {filteredBranches.map((branch) => (
                      <RefRow
                        key={branch.name}
                        refWithStatus={branch}
                        isSelected={branch.name === currentRef}
                        onSelect={() => handleSelect(branch.name)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Separator between branches and tags */}
              {filteredBranches.length > 0 && <Separator className="my-2" />}

              {/* Tags section — always shown so the count is visible */}
              <div>
                <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <Tag className="h-3 w-3" />
                  Tags
                  <span className="text-muted-foreground/40 font-normal normal-case tracking-normal">
                    ({filteredTags.length})
                  </span>
                </div>
                {filteredTags.length > 0 && (
                  <div className="px-1">
                    {filteredTags.map((tag) => (
                      <RefRow
                        key={tag.name}
                        refWithStatus={tag}
                        isSelected={tag.name === currentRef}
                        onSelect={() => handleSelect(tag.name)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Empty search state */}
              {filteredBranches.length === 0 &&
                filteredTags.length === 0 &&
                search && (
                  <div className="py-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      No refs matching "{search}"
                    </p>
                  </div>
                )}
            </div>
          </ScrollArea>

          {/* Footer with legend */}
          {repoState !== null && repoState !== undefined && (
            <>
              <Separator />
              <div className="px-3 py-2 flex items-center gap-3 text-[11px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-500/70" />
                  signed
                </span>
                <span className="flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3 text-amber-500/70" />
                  out of sync
                </span>
                <span className="flex items-center gap-1">
                  <ShieldQuestion className="h-3 w-3 text-muted-foreground/40" />
                  git server only
                </span>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* ------------------------------------------------------------------ */}
      {/* Grasp / git-server status button                                    */}
      {/* ------------------------------------------------------------------ */}
      {cloneUrls.length > 0 && (
        <Popover open={serverPanelOpen} onOpenChange={setServerPanelOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center justify-center h-8 w-8 rounded-md border text-xs transition-all duration-200",
                    "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    // Colour the button border/bg based on overall server health
                    matchingServerCount === totalServerCount &&
                      totalServerCount > 0
                      ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                      : matchingServerCount > 0
                        ? "border-amber-500/30 text-amber-600 dark:text-amber-400"
                        : "border-border/60 text-muted-foreground",
                  )}
                  aria-label="Git server status"
                >
                  {usesGrasp ? (
                    <GraspLogo className="h-4 w-4" />
                  ) : (
                    <GitServerIcon
                      statuses={serverStatuses}
                      className="h-4 w-4"
                    />
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="text-xs max-w-[260px]"
              sideOffset={6}
            >
              <ServerStatusTooltip
                graspTotal={graspCloneUrls.length}
                graspMatch={graspMatchCount}
                additionalTotal={additionalGitServerUrls.length}
                additionalMatch={additionalMatchCount}
              />
            </TooltipContent>
          </Tooltip>

          <PopoverContent
            className="p-0 overflow-hidden"
            align="start"
            sideOffset={6}
          >
            <GitServerPanel
              serverStatuses={serverStatuses}
              repoState={repoState}
              repoRelayEose={repoRelayEose}
              currentRef={currentRef}
              matchingCount={matchingServerCount}
              totalCount={totalServerCount}
              graspCloneUrls={graspCloneUrls}
              additionalGitServerUrls={additionalGitServerUrls}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
