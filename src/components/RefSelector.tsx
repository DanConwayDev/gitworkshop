import { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
  Radio,
  Server,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { PoolWarning, UrlState } from "@/lib/git-grasp-pool/types";
import type { GitGraspPool } from "@/lib/git-grasp-pool";

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
  /**
   * True when the git server is confirmed ahead of the signed Nostr state.
   * Ref commit differences are expected in this case and should not be shown
   * as suspicious mismatches.
   */
  stateBehindGit?: boolean;
  /**
   * Warning from the git pool (state-behind-git, state-commit-unavailable).
   * When state-behind-git, the warning's gitServerUrl identifies the server
   * whose unsigned commit is being displayed.
   */
  poolWarning?: PoolWarning | null;
  /**
   * The clone URL of the winning git server (from poolState.winnerUrl).
   * Used as a fallback when no signed state exists (no-state) to show
   * which server the data is coming from.
   */
  winnerUrl?: string | null;
  /**
   * Unix timestamp (seconds) of the Nostr state event — used to show
   * how stale the signed state is relative to what git servers have.
   */
  stateCreatedAt?: number;
  /**
   * Per-URL state from the pool — used in the expanded diff summary to show
   * per-server commit info for differing refs.
   */
  urlStates?: Record<string, UrlState>;
  /** All clone URLs — used to order servers in the expanded diff summary. */
  cloneUrls?: string[];
  /**
   * Pool instance — used to lazily fetch commit timestamps for differing refs
   * so we can show "committed 3 months ago" in the expanded section.
   */
  pool?: GitGraspPool | null;
}

/**
 * Status of a ref's verification against the signed state event.
 *
 * - "verified"        : state event exists and this ref's commit matches
 * - "mismatch"        : state event exists but declares a different commit for this ref
 * - "state-behind"    : git server is ahead of the signed state (expected lag, not suspicious)
 * - "git-server-only" : state event exists but doesn't include this ref
 * - "no-state"        : no state event was found (after EOSE)
 * - "loading"         : still waiting for state event data
 */
type RefStatus =
  | "verified"
  | "mismatch"
  | "state-behind"
  | "git-server-only"
  | "no-state"
  | "loading";

interface RefWithStatus extends GitRef {
  status: RefStatus;
  stateCommit?: string; // commit declared by state event (if different)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the hostname from a URL string, falling back to the raw URL. */
function gitServerDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getRefStatus(
  ref: GitRef,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
  stateBehindGit: boolean,
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
    // When the git server is confirmed ahead of the signed state, new refs
    // that don't appear in the state are expected — don't flag them.
    if (stateBehindGit) return { status: "state-behind" };
    return { status: "git-server-only" };
  }

  // When the git server is confirmed ahead of the signed state, the default
  // branch is always "state-behind" — even if its hash happens to match the
  // state ref, the HEAD comparison already proved the server is ahead.
  if (stateBehindGit && ref.isDefault) {
    return { status: "state-behind", stateCommit: stateRef.commitId };
  }

  // Compare commits (handle both full and abbreviated hashes)
  if (
    ref.hash === stateRef.commitId ||
    ref.hash.startsWith(stateRef.commitId) ||
    stateRef.commitId.startsWith(ref.hash)
  ) {
    return { status: "verified" };
  }

  // When the git server is confirmed ahead of the signed state, a commit
  // difference on any other ref is expected — use a softer status.
  if (stateBehindGit)
    return { status: "state-behind", stateCommit: stateRef.commitId };

  return { status: "mismatch", stateCommit: stateRef.commitId };
}

function countMismatches(refsWithStatus: RefWithStatus[]): number {
  return refsWithStatus.filter((r) => r.status === "mismatch").length;
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
    case "state-behind":
      return (
        <AlertTriangle className={cn("h-3 w-3 text-amber-500", className)} />
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
          Matches Nostr state — the maintainer's published state matches this
          git server
        </span>
      );
    case "mismatch":
      return (
        <div className="space-y-1">
          <p className="font-medium text-amber-400">Differs from Nostr state</p>
          <p>
            Nostr state has{" "}
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
    case "state-behind":
      return (
        <span>
          The git server has newer commits than the maintainer's last Nostr
          state — the maintainer hasn't re-published yet
        </span>
      );
    case "git-server-only":
      return (
        <span>
          This ref exists on the git server but isn't in the maintainer's Nostr
          state
        </span>
      );
    case "no-state":
      return null;
    case "loading":
      return <span>Checking Nostr state…</span>;
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

// ---------------------------------------------------------------------------
// Popover header: source row + optional expandable diff-summary bar
// ---------------------------------------------------------------------------

/** Short hostname from a clone URL, e.g. "github.com/foo/bar" */
function shortServerLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

/**
 * A single ref row inside the expanded diff summary.
 * Shows the nostr state commit and per-server commits with committer timestamps.
 */
function DiffRefRow({
  refItem,
  cloneUrls,
  urlStates,
  pool,
}: {
  refItem: RefWithStatus;
  cloneUrls: string[];
  urlStates: Record<string, UrlState>;
  pool?: GitGraspPool | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const fullRefName = `${refItem.isBranch ? "refs/heads/" : "refs/tags/"}${refItem.name}`;
  // For annotated tags the pool stores the peeled commit under "refs/tags/foo^{}"
  const peeledRefName = fullRefName + "^{}";

  // Collect per-server commit info from urlStates
  const serverEntries = useMemo(() => {
    return cloneUrls
      .map((url) => {
        const us = urlStates[url];
        if (!us || us.status === "untested") return null;
        // Prefer peeled (annotated tag) commit, fall back to raw
        const commit =
          us.refCommits[peeledRefName] ?? us.refCommits[fullRefName];
        if (!commit) return null;
        return { url, label: shortServerLabel(url), commit };
      })
      .filter(
        (e): e is { url: string; label: string; commit: string } => e !== null,
      );
  }, [cloneUrls, urlStates, fullRefName, peeledRefName]);

  return (
    <div className="pl-2">
      {/* Ref header row — clickable to expand */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full text-left py-0.5"
      >
        {refItem.isBranch ? (
          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        ) : (
          <Tag className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        )}
        <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] shrink-0">
          {refItem.name}
        </code>
        <span className="text-amber-600/80 dark:text-amber-400/70">
          {refItem.status === "mismatch"
            ? "differs from nostr"
            : "ahead of nostr"}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
        )}
      </button>

      {/* Per-source breakdown */}
      {expanded && (
        <div className="mt-1 ml-2 space-y-1 border-l border-border/40 pl-3 pb-1">
          {/* Nostr state row */}
          {refItem.stateCommit && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <Radio className="h-3 w-3 text-purple-500 dark:text-purple-400 shrink-0" />
              <span className="text-muted-foreground/70 shrink-0">nostr</span>
              <code className="font-mono bg-muted px-1 rounded shrink-0">
                {refItem.stateCommit.slice(0, 8)}
              </code>
            </div>
          )}

          {/* Per-server rows */}
          {serverEntries.map((entry) => (
            <ServerCommitRow
              key={entry.url}
              entry={entry}
              stateCommit={refItem.stateCommit}
              pool={pool}
            />
          ))}

          {serverEntries.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50">
              no server data yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A single server row inside an expanded DiffRefRow.
 * Lazily fetches the committer timestamp for the server's commit.
 */
function ServerCommitRow({
  entry,
  stateCommit,
  pool,
}: {
  entry: { url: string; label: string; commit: string };
  stateCommit?: string;
  pool?: GitGraspPool | null;
}) {
  const [commitTs, setCommitTs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const matchesState =
    stateCommit !== undefined &&
    (entry.commit === stateCommit ||
      entry.commit.startsWith(stateCommit) ||
      stateCommit.startsWith(entry.commit));

  useEffect(() => {
    if (!pool) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    pool
      .getSingleCommit(entry.commit, ac.signal)
      .then((commit) => {
        if (ac.signal.aborted || !commit) return;
        const ts = commit.committer?.timestamp ?? commit.author.timestamp;
        setCommitTs(ts);
      })
      .catch(() => {
        /* ignore — timestamp stays null */
      });

    return () => {
      ac.abort();
    };
  }, [entry.commit, pool]);

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {matchesState ? (
        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
      ) : (
        <XCircle className="h-3 w-3 text-amber-500 shrink-0" />
      )}
      <span
        className="font-mono text-muted-foreground truncate min-w-0"
        title={entry.url}
      >
        {entry.label}
      </span>
      <code className="font-mono bg-muted px-1 rounded shrink-0">
        {entry.commit.slice(0, 8)}
      </code>
      {commitTs !== null && (
        <span className="text-muted-foreground/50 shrink-0">
          · {safeFormatDistanceToNow(commitTs, { addSuffix: true })}
        </span>
      )}
    </div>
  );
}

/**
 * Subtle expandable bar below the source header that explains ref discrepancies.
 *
 * Two modes:
 *   - stateBehindGit: "master is 3 months ahead of nostr and 2 other refs differ"
 *   - nostr source with mismatches: "2 refs differ across git servers"
 *
 * Clicking expands a per-ref breakdown (each ref further expandable to show
 * per-server commits with committer timestamps).
 */
function DiffSummaryBar({
  refsWithStatus,
  stateBehindGit,
  defaultBranchName,
  stateCreatedAt,
  cloneUrls,
  urlStates,
  pool,
}: {
  refsWithStatus: RefWithStatus[];
  stateBehindGit: boolean;
  defaultBranchName?: string;
  stateCreatedAt?: number;
  cloneUrls: string[];
  urlStates: Record<string, UrlState>;
  pool?: GitGraspPool | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const differingRefs = useMemo(() => {
    if (stateBehindGit) {
      return refsWithStatus.filter(
        (r) => r.status === "state-behind" || r.status === "mismatch",
      );
    }
    return refsWithStatus.filter((r) => r.status === "mismatch");
  }, [refsWithStatus, stateBehindGit]);

  if (differingRefs.length === 0) return null;

  const defaultRef = differingRefs.find((r) => r.isDefault);
  const otherDifferingCount = defaultRef
    ? differingRefs.length - 1
    : differingRefs.length;

  const stateAge =
    stateCreatedAt !== undefined
      ? safeFormatDistanceToNow(stateCreatedAt, { addSuffix: true })
      : null;

  // Subtle summary sentence
  let summaryText: React.ReactNode;
  if (stateBehindGit && defaultRef) {
    const branchName = defaultBranchName ?? defaultRef.name;
    summaryText = (
      <>
        <code className="font-mono bg-muted px-1 rounded text-[10px]">
          {branchName}
        </code>{" "}
        is{stateAge ? ` ${stateAge}` : ""} ahead of nostr
        {otherDifferingCount > 0 && (
          <>
            {" "}
            and {otherDifferingCount} other ref
            {otherDifferingCount !== 1 ? "s" : ""} differ
          </>
        )}
      </>
    );
  } else if (stateBehindGit) {
    summaryText = (
      <>
        {differingRefs.length} refs ahead of nostr
        {stateAge && <> ({stateAge})</>}
      </>
    );
  } else {
    summaryText = (
      <>
        {differingRefs.length} ref{differingRefs.length !== 1 ? "s" : ""} differ{" "}
        across git servers
      </>
    );
  }

  return (
    <div className="border-b border-border/40">
      {/* Summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors text-left"
      >
        <span className="flex-1 min-w-0">{summaryText}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
      </button>

      {/* Expanded per-ref list */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {differingRefs.map((ref) => (
            <DiffRefRow
              key={ref.name}
              refItem={ref}
              cloneUrls={cloneUrls}
              urlStates={urlStates}
              pool={pool}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The source label shown at the top of the popover.
 *
 * Scenarios:
 *   - Nostr state exists and is current → "nostr" (emerald)
 *   - Nostr state exists but git server is ahead → git domain (amber)
 *   - No Nostr state → git domain (muted)
 *   - Loading → "nostr" (muted, still checking)
 */
function SourceHeader({
  repoState,
  repoRelayEose,
  stateBehindGit,
  poolWarning,
  winnerUrl,
  mismatchCount,
  isNoState,
  refsWithStatus,
  stateCreatedAt,
  cloneUrls,
  urlStates,
  pool,
}: {
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  stateBehindGit: boolean;
  poolWarning?: PoolWarning | null;
  winnerUrl?: string | null;
  mismatchCount: number;
  isNoState: boolean;
  refsWithStatus: RefWithStatus[];
  stateCreatedAt?: number;
  cloneUrls: string[];
  urlStates: Record<string, UrlState>;
  pool?: GitGraspPool | null;
}) {
  const gitSourceUrl =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitServerUrl
      : winnerUrl;
  const gitDomain = gitSourceUrl ? gitServerDomain(gitSourceUrl) : null;

  const isLoading = repoState === undefined || !repoRelayEose;
  const isGitSource = stateBehindGit || isNoState;
  const hasProblems = mismatchCount > 0 || stateBehindGit;

  const sourceLabel = isGitSource && gitDomain ? gitDomain : "nostr";
  const sourceIsNostr = !isGitSource;

  const defaultBranchName = useMemo(() => {
    return refsWithStatus.find((r) => r.isDefault && r.isBranch)?.name;
  }, [refsWithStatus]);

  const showDiffSummary = hasProblems && !isLoading;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b text-[11px]",
          hasProblems
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border/40 bg-muted/20",
          showDiffSummary && "border-b-0",
        )}
      >
        {/* Source icon */}
        {sourceIsNostr ? (
          <Radio
            className={cn(
              "h-3 w-3 shrink-0",
              isLoading
                ? "text-muted-foreground/40"
                : "text-purple-500 dark:text-purple-400",
            )}
          />
        ) : (
          <Server
            className={cn(
              "h-3 w-3 shrink-0",
              hasProblems ? "text-amber-500" : "text-muted-foreground/60",
            )}
          />
        )}

        <span className="text-muted-foreground/60 shrink-0">Source</span>

        <span
          className={cn(
            "font-medium truncate",
            isLoading
              ? "text-muted-foreground/50"
              : sourceIsNostr
                ? "text-purple-600 dark:text-purple-400"
                : hasProblems
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground/80",
          )}
        >
          {sourceLabel}
        </span>

        {/* Right-side status badge */}
        {hasProblems ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto flex items-center gap-1 shrink-0 cursor-default">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {stateBehindGit
                    ? "ahead of nostr"
                    : mismatchCount === 1
                      ? "1 ref differs"
                      : `${mismatchCount} refs differ`}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[260px] text-xs"
              sideOffset={6}
            >
              {stateBehindGit ? (
                <span>
                  The git server has newer unsigned commits than the
                  maintainer's last Nostr state. Showing the git server's latest
                  data.
                </span>
              ) : (
                <span>
                  {mismatchCount === 1
                    ? "1 ref differs"
                    : `${mismatchCount} refs differ`}{" "}
                  from the Nostr state. This could mean a recent push hasn't
                  been re-published to Nostr yet.
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        ) : isNoState ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ml-auto flex items-center gap-1 shrink-0 cursor-default text-muted-foreground/60">
                <span>no Nostr state</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-[240px] text-xs"
              sideOffset={6}
            >
              The maintainer hasn't published a Nostr state for this repo yet.
              Showing git server data only.
            </TooltipContent>
          </Tooltip>
        ) : !isLoading && sourceIsNostr ? (
          <span className="ml-auto text-muted-foreground/50 shrink-0">
            all git servers in sync
          </span>
        ) : null}
      </div>

      {/* Subtle expandable diff summary */}
      {showDiffSummary && (
        <DiffSummaryBar
          refsWithStatus={refsWithStatus}
          stateBehindGit={stateBehindGit}
          defaultBranchName={defaultBranchName}
          stateCreatedAt={stateCreatedAt}
          cloneUrls={cloneUrls}
          urlStates={urlStates}
          pool={pool}
        />
      )}
    </>
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
  stateBehindGit = false,
  poolWarning,
  winnerUrl,
  stateCreatedAt,
  urlStates = {},
  cloneUrls = [],
  pool,
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  // Separate max-height for the ScrollArea so it scrolls independently of the
  // fixed header/search/footer sections inside the popover.
  const [scrollAreaMaxHeight, setScrollAreaMaxHeight] = useState(360);

  // Recompute popover dimensions whenever the dropdown opens or viewport resizes.
  const updatePopoverStyle = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Measure the sticky app header height so we can factor it in.
    // Total space available below the trigger (sideOffset is 6px, add 8px breathing room).
    const availableHeight = window.innerHeight - rect.bottom - 6 - 8;
    // Reserve space for the fixed parts: source header (~36px), optional search
    // (~44px), optional footer (~36px). Use a conservative 120px reservation so
    // the ScrollArea always gets a sensible slice of the available space.
    const fixedPartsHeight = 120;
    const safeScrollHeight = Math.max(availableHeight - fixedPartsHeight, 80);
    setScrollAreaMaxHeight(safeScrollHeight);

    if (isMobile) {
      // Radix positions the popover at the trigger's left edge (align="start").
      // Shift it left by that amount so it spans the full viewport width.
      setPopoverStyle({
        width: "100vw",
        maxWidth: "100vw",
        marginLeft: `-${rect.left}px`,
      });
    } else {
      setPopoverStyle({});
    }
  }, [isMobile]);

  useEffect(() => {
    if (!open) return;
    updatePopoverStyle();
    window.addEventListener("resize", updatePopoverStyle);
    return () => window.removeEventListener("resize", updatePopoverStyle);
  }, [open, updatePopoverStyle]);

  // On mobile, scroll the trigger into view when the dropdown opens so both
  // the button and the list are visible simultaneously.
  useEffect(() => {
    if (!open || !isMobile) return;
    const el = triggerRef.current;
    if (!el) return;
    // Small delay to let the popover render first.
    const id = setTimeout(() => {
      const stickyHeader = document.querySelector("header.sticky");
      const headerHeight = stickyHeader
        ? stickyHeader.getBoundingClientRect().height
        : 0;
      // Scroll so the trigger sits just below the sticky header.
      const triggerTop =
        el.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo({ top: triggerTop, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(id);
  }, [open, isMobile]);

  // Compute status for each ref
  const refsWithStatus: RefWithStatus[] = useMemo(
    () =>
      refs.map((ref) => ({
        ...ref,
        ...getRefStatus(ref, repoState, repoRelayEose, stateBehindGit),
      })),
    [refs, repoState, repoRelayEose, stateBehindGit],
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

  // Only count genuine mismatches (not state-behind) for the issues row
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

  // Show the status indicator in the trigger when we have a definitive status
  // for the selected ref.
  const showStatusIcon =
    currentStatus !== "loading" && currentStatus !== "no-state";

  // Amber trigger border when there are genuine mismatches or state is behind
  const showAmberTrigger = mismatchCount > 0 || stateBehindGit;

  // Determine the source prefix for the trigger.
  //
  // When state-behind-git, the warning carries the exact server URL whose
  // unsigned commit is being displayed. For no-state, fall back to the pool's
  // winner URL. When Nostr state is current (verified / mismatch / loading),
  // always show "nostr".
  const gitSourceUrl =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitServerUrl
      : winnerUrl;
  const gitDomain = gitSourceUrl ? gitServerDomain(gitSourceUrl) : null;

  // Only show a source prefix in the trigger when the source is a git server
  // (not Nostr). In the happy path (Nostr is current) the prefix is omitted
  // to keep the trigger compact — the popover header always shows the source.
  const showGitPrefix = (stateBehindGit || isNoState) && gitDomain;
  const sourcePrefix = gitDomain;

  const handleSelect = (refName: string) => {
    onRefChange(refName);
    setOpen(false);
    setSearch("");
  };

  if (loading && refs.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs transition-all duration-200",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "max-w-[320px]",
            showAmberTrigger
              ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
              : "border-border/60 bg-background",
          )}
        >
          {/* Source prefix — only shown when source is a git server, not nostr */}
          {showGitPrefix && (
            <>
              <span
                className={cn(
                  "truncate max-w-[100px] shrink-0",
                  showAmberTrigger
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground/70",
                )}
              >
                {sourcePrefix}
              </span>
              <span className="text-muted-foreground/40 shrink-0">/</span>
            </>
          )}

          {/* Branch/tag icon */}
          {currentIsTag ? (
            <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}

          {/* Ref name */}
          <span className="truncate font-medium">{currentRef}</span>

          {/* Per-ref status icon */}
          {showStatusIcon ? (
            <span className="shrink-0 ml-0.5">
              {currentStatus === "verified" && (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              )}
              {currentStatus === "mismatch" && (
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              )}
              {currentStatus === "state-behind" && (
                <AlertTriangle className="h-3 w-3 text-amber-500" />
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
        className={cn(
          "p-0 overflow-hidden",
          isMobile ? "w-screen" : "w-[420px]",
        )}
        align="start"
        sideOffset={6}
        style={popoverStyle}
        avoidCollisions={!isMobile}
      >
        {/* Source header — always shown, replaces the old banners */}
        <SourceHeader
          repoState={repoState}
          repoRelayEose={repoRelayEose}
          stateBehindGit={stateBehindGit}
          poolWarning={poolWarning}
          winnerUrl={winnerUrl}
          mismatchCount={mismatchCount}
          isNoState={isNoState}
          refsWithStatus={refsWithStatus}
          stateCreatedAt={stateCreatedAt}
          cloneUrls={cloneUrls}
          urlStates={urlStates}
          pool={pool}
        />

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

        <ScrollArea
          style={{
            height: `${scrollAreaMaxHeight}px`,
            maxHeight: `${scrollAreaMaxHeight}px`,
          }}
        >
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
                matches nostr
              </span>
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-amber-500/70" />
                differs from nostr
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
  );
}
