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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Minus,
  Braces,
} from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import { formatDistanceStrict } from "date-fns";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import { deriveEffectiveSource } from "@/lib/sourceUtils";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type { PoolWarning, UrlState } from "@/lib/git-grasp-pool/types";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import {
  type RefStatus,
  type RefWithStatus,
  compareTagsNewestFirst,
} from "@/lib/refStatus";
import { useRefsWithStatus } from "@/hooks/useRefsWithStatus";
import { SourceSelector, gitServerDomain } from "@/components/SourceSelector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefSelectorProps {
  refs: GitRef[];
  currentRef: string;
  onRefChange: (ref: string) => void;
  /**
   * The currently selected verification source.
   * "default" = pool-decided, "nostr" = explicit nostr override, or a clone URL.
   * Defaults to "default" when omitted.
   */
  selectedSource?: string;
  /**
   * Called whenever the user changes the verification source.
   * "default" = pool-decided, "nostr" = explicit nostr override, or a URL.
   */
  onSourceChange?: (source: string) => void;
  /**
   * Called when the user selects a source that doesn't have the current ref.
   * Receives the new source so the caller can atomically navigate to the
   * default branch while applying the source change in one step.
   * When omitted, the source change is applied normally without a ref revert.
   */
  onRefAndSourceChange?: (defaultRef: string, newSource: string) => void;
  /** The winning Nostr state event, null if none found, undefined while loading */
  repoState: RepositoryState | null | undefined;
  /** True once the relay EOSE has been received for the state query */
  repoRelayEose: boolean;
  /**
   * Per-relay state registry from useRepositoryState. Maps relay URL to the
   * best state event seen from that relay. Used to detect when a git server
   * is serving an older (but previously signed) Nostr state.
   */
  relayStateMap?: Map<string, NostrEvent>;
  /** True while data is still being fetched */
  loading?: boolean;
  /**
   * True when the git server is confirmed ahead of the Nostr-announced state.
   * Ref commit differences are expected in this case and should not be shown
   * as suspicious mismatches.
   */
  stateBehindGit?: boolean;
  /**
   * Warning from the git pool (state-behind-git, state-commit-unavailable).
   * When state-behind-git, the warning's gitServerUrl identifies the server
   * whose unannounced commit is being displayed.
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
  /** Subset of cloneUrls that are Grasp server clone URLs */
  graspCloneUrls?: string[];
  /** Subset of cloneUrls that are NOT Grasp server clone URLs */
  additionalGitServerUrls?: string[];
  /**
   * Pool instance — used to lazily fetch commit timestamps for differing refs
   * so we can show "committed 3 months ago" in the expanded section.
   */
  pool?: GitGraspPool | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// gitServerDomain is imported from @/components/SourceSelector

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
    case "old-state":
      return (
        <ShieldAlert className={cn("h-3.5 w-3.5 text-sky-500", className)} />
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
    case "not-on-server":
      return (
        <Minus className={cn("h-3 w-3 text-muted-foreground/30", className)} />
      );
    case "no-state":
      return null;
    case "loading":
      return null;
  }
}

function StatusTooltipText({
  refWithStatus,
  effectiveSource,
}: {
  refWithStatus: RefWithStatus;
  effectiveSource: string; // "nostr" or a concrete clone URL — never "default"
}) {
  const serverLabel =
    effectiveSource !== "nostr" ? gitServerDomain(effectiveSource) : null;

  switch (refWithStatus.status) {
    case "verified":
      return (
        <span>
          {serverLabel
            ? `${serverLabel} matches the Nostr state for this ref`
            : "Matches Nostr state — the maintainer's published state matches this git server"}
        </span>
      );
    case "mismatch": {
      const displayServerCommit = (
        refWithStatus.serverCommit ?? refWithStatus.hash
      ).slice(0, 8);
      const displayStateCommit = refWithStatus.stateCommit?.slice(0, 8);
      return (
        <div className="space-y-1">
          <p className="font-medium text-amber-400">Differs from Nostr state</p>
          <p>
            Nostr state has{" "}
            <code className="font-mono text-[11px] bg-amber-500/20 px-1 rounded">
              {displayStateCommit}
            </code>{" "}
            but {serverLabel ? serverLabel : "the git server"} has{" "}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">
              {displayServerCommit}
            </code>
          </p>
          <p className="text-muted-foreground text-[11px]">
            The maintainer likely pushed directly to{" "}
            {serverLabel ? serverLabel : "the git server"} without publishing a
            Nostr state update.
          </p>
        </div>
      );
    }
    case "old-state": {
      const displayServerCommit = (
        refWithStatus.serverCommit ?? refWithStatus.hash
      ).slice(0, 8);
      return (
        <div className="space-y-1">
          <p className="font-medium text-sky-400">
            Matches an older Nostr state
          </p>
          <p>
            {serverLabel ? serverLabel : "This server"} has{" "}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">
              {displayServerCommit}
            </code>{" "}
            which matches a previously published state
            {refWithStatus.oldStateCreatedAt && (
              <>
                {" "}
                from{" "}
                {safeFormatDistanceToNow(refWithStatus.oldStateCreatedAt, {
                  addSuffix: true,
                })}
              </>
            )}
            . The latest Nostr state has{" "}
            <code className="font-mono text-[11px] bg-sky-500/20 px-1 rounded">
              {refWithStatus.stateCommit?.slice(0, 8)}
            </code>
            .
          </p>
          <p className="text-muted-foreground text-[11px]">
            This server hasn't synced to the latest Nostr state yet.
          </p>
        </div>
      );
    }
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
    case "not-on-server":
      return (
        <span>
          This ref is not available on {serverLabel ?? "the selected server"}
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
  effectiveSource,
  pool,
  urlStates,
}: {
  refWithStatus: RefWithStatus;
  isSelected: boolean;
  onSelect: () => void;
  /** Resolved source — "nostr" or a concrete clone URL, never "default". */
  effectiveSource: string;
  pool?: GitGraspPool | null;
  urlStates?: Record<string, UrlState>;
}) {
  const [commitTs, setCommitTs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Resolve the commit hash for the effective source.
  // When the source is a git server URL, use that server's commit for this ref
  // (from refCommits) so the timestamp reflects what that server has, not the
  // pool winner's commit.
  const fullRefName = `${refWithStatus.isBranch ? "refs/heads/" : "refs/tags/"}${refWithStatus.name}`;
  const sourceHash = useMemo(() => {
    if (effectiveSource !== "nostr" && urlStates) {
      const us = urlStates[effectiveSource];
      // Prefer peeled commit (annotated tags), fall back to raw ref
      return (
        us?.refCommits[`${fullRefName}^{}`] ??
        us?.refCommits[fullRefName] ??
        refWithStatus.hash
      );
    }
    return refWithStatus.hash;
  }, [effectiveSource, urlStates, fullRefName, refWithStatus.hash]);

  useEffect(() => {
    if (!pool) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCommitTs(null);

    pool
      .getSingleCommit(sourceHash, ac.signal)
      .then((commit) => {
        if (ac.signal.aborted || !commit) return;
        setCommitTs(commit.committer?.timestamp ?? commit.author.timestamp);
      })
      .catch(() => {});

    return () => {
      ac.abort();
    };
  }, [sourceHash, pool]);
  // "not-on-server" = ref absent from the selected git server
  // "git-server-only" = ref absent from nostr state; fade it only when nostr
  //   is the effective source so the user can see these refs exist but
  //   understand they're not in the signed state. When a git server is the
  //   source (stateBehindGit, no-state, or manual selection) these refs are
  //   fully present and should not be dimmed.
  const sourceIsGitServer = effectiveSource !== "nostr";
  const isAbsent =
    refWithStatus.status === "not-on-server" ||
    (refWithStatus.status === "git-server-only" && !sourceIsGitServer);
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
        refWithStatus.status === "old-state" &&
          "hover:bg-sky-500/10 dark:hover:bg-sky-500/10",
        isAbsent && "opacity-50",
      )}
    >
      {/* Selection check */}
      <div className="w-4 shrink-0">
        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
      </div>

      {/* Ref name + committer timestamp */}
      <span className="flex-1 flex items-baseline gap-2 min-w-0 overflow-hidden">
        <span
          className={cn(
            "truncate font-mono text-[13px]",
            isSelected && "font-medium",
            refWithStatus.status === "mismatch" &&
              "text-amber-600 dark:text-amber-400",
            refWithStatus.status === "old-state" &&
              "text-sky-600 dark:text-sky-400",
            isAbsent && "text-muted-foreground",
          )}
          title={refWithStatus.name}
        >
          {refWithStatus.name}
        </span>
        {commitTs !== null && (
          <span className="shrink-0 text-[11px] text-muted-foreground/40 font-normal">
            {safeFormatDistanceToNow(commitTs, { addSuffix: true })}
          </span>
        )}
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
          <StatusTooltipText
            refWithStatus={refWithStatus}
            effectiveSource={effectiveSource}
          />
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
      {stateCommit === undefined ? (
        <Server className="h-3 w-3 text-muted-foreground/40 shrink-0" />
      ) : matchesState ? (
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
 * A single git-server-only ref row in the expanded diff summary.
 * Shows which servers have the ref and their commits.
 * Expandable when servers differ or there are multiple servers to list.
 */
function GitServerOnlyRefRow({
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
  const peeledRefName = fullRefName + "^{}";

  // Servers that have this ref
  const serverEntries = useMemo(() => {
    return cloneUrls
      .map((url) => {
        const us = urlStates[url];
        if (!us || us.status === "untested") return null;
        const commit =
          us.refCommits[peeledRefName] ?? us.refCommits[fullRefName];
        if (!commit) return null;
        return { url, label: gitServerDomain(url), commit };
      })
      .filter(
        (e): e is { url: string; label: string; commit: string } => e !== null,
      );
  }, [cloneUrls, urlStates, fullRefName, peeledRefName]);

  // Unique commits across servers
  const uniqueCommits = useMemo(
    () => new Set(serverEntries.map((e) => e.commit)),
    [serverEntries],
  );
  const allSameCommit = uniqueCommits.size <= 1;
  // Only expandable when there's something useful to show in the detail view:
  // multiple servers (to see per-server commits) or differing commits
  const canExpand = serverEntries.length > 1 || !allSameCommit;

  // Inline server label: "github.com" or "github.com, gitlab.com"
  const inlineServers =
    serverEntries.length > 0
      ? serverEntries.map((e) => e.label).join(", ")
      : null;

  return (
    <div className="pl-2">
      <button
        onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
        disabled={!canExpand}
        className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground w-full text-left py-0.5",
          canExpand && "hover:text-foreground transition-colors",
        )}
      >
        {refItem.isBranch ? (
          <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        ) : (
          <Tag className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        )}
        <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px] shrink-0">
          {refItem.name}
        </code>
        {inlineServers && (
          <span className="text-muted-foreground/50 truncate min-w-0">
            {inlineServers}
            {allSameCommit && serverEntries[0] && (
              <code className="font-mono ml-1 text-[10px]">
                {serverEntries[0].commit.slice(0, 8)}
              </code>
            )}
          </span>
        )}
        {canExpand && (
          <>
            {expanded ? (
              <ChevronUp className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-auto shrink-0 text-muted-foreground/50" />
            )}
          </>
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-2 space-y-1 border-l border-border/40 pl-3 pb-1">
          {serverEntries.map((entry) => (
            <ServerCommitRow
              key={entry.url}
              entry={entry}
              stateCommit={undefined}
              pool={pool}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Subtle expandable bar below the source header that explains ref discrepancies.
 * Only shown when selectedSource === "nostr".
 */
function DiffSummaryBar({
  refsWithStatus,
  stateBehindGit,
  defaultBranchName,
  gitAheadDistance,
  cloneUrls,
  urlStates,
  pool,
  sourceIsNostr,
}: {
  refsWithStatus: RefWithStatus[];
  stateBehindGit: boolean;
  defaultBranchName?: string;
  /** Human-readable distance the git server is ahead of the Nostr state, e.g. "3 months" */
  gitAheadDistance?: string | null;
  cloneUrls: string[];
  urlStates: Record<string, UrlState>;
  pool?: GitGraspPool | null;
  /** True when the user has explicitly selected nostr as the source */
  sourceIsNostr?: boolean;
}) {
  const PAGE_SIZE = 6;
  const [expanded, setExpanded] = useState(false);
  const [differingVisible, setDifferingVisible] = useState(PAGE_SIZE);
  const [gitOnlyVisible, setGitOnlyVisible] = useState(PAGE_SIZE);

  // Reset pagination when collapsed so re-opening starts from the top
  const handleToggle = () => {
    if (expanded) {
      setDifferingVisible(PAGE_SIZE);
      setGitOnlyVisible(PAGE_SIZE);
    }
    setExpanded((v) => !v);
  };

  const differingRefs = useMemo(() => {
    if (stateBehindGit) {
      return refsWithStatus.filter(
        (r) => r.status === "state-behind" || r.status === "mismatch",
      );
    }
    return refsWithStatus.filter((r) => r.status === "mismatch");
  }, [refsWithStatus, stateBehindGit]);

  const gitServerOnlyRefs = useMemo(
    () => refsWithStatus.filter((r) => r.status === "git-server-only"),
    [refsWithStatus],
  );

  if (differingRefs.length === 0 && gitServerOnlyRefs.length === 0) return null;

  const defaultRef = differingRefs.find((r) => r.isDefault);
  const otherDifferingCount = defaultRef
    ? differingRefs.length - 1
    : differingRefs.length;

  // Subtle summary sentence
  let summaryText: React.ReactNode;
  if (stateBehindGit && defaultRef) {
    const branchName = defaultBranchName ?? defaultRef.name;
    // Total "extra" items: other differing refs + git-server-only refs
    const extraCount = otherDifferingCount + gitServerOnlyRefs.length;
    summaryText = sourceIsNostr ? (
      <>
        git servers:{" "}
        <code className="font-mono bg-muted px-1 rounded text-[10px]">
          {branchName}
        </code>{" "}
        ahead of nostr
        {gitAheadDistance && <> by {gitAheadDistance}</>}
        {extraCount > 0 && (
          <>
            , {extraCount} other ref{extraCount !== 1 ? "s" : ""} differ
          </>
        )}
      </>
    ) : (
      <>
        <code className="font-mono bg-muted px-1 rounded text-[10px]">
          {branchName}
        </code>{" "}
        is ahead of nostr
        {gitAheadDistance && <> by {gitAheadDistance}</>}
        {extraCount > 0 && (
          <>
            , {extraCount} other ref{extraCount !== 1 ? "s" : ""} differ
          </>
        )}
      </>
    );
  } else if (stateBehindGit) {
    const extraCount = gitServerOnlyRefs.length;
    summaryText = sourceIsNostr ? (
      <>
        git servers: {differingRefs.length} ref
        {differingRefs.length !== 1 ? "s" : ""} ahead of nostr
        {gitAheadDistance && <> by {gitAheadDistance}</>}
        {extraCount > 0 && (
          <>
            , {extraCount} git-server-only ref{extraCount !== 1 ? "s" : ""}
          </>
        )}
      </>
    ) : (
      <>
        {differingRefs.length} ref{differingRefs.length !== 1 ? "s" : ""} ahead
        of nostr
        {gitAheadDistance && <> by {gitAheadDistance}</>}
        {extraCount > 0 && (
          <>
            , {extraCount} git-server-only ref{extraCount !== 1 ? "s" : ""}
          </>
        )}
      </>
    );
  } else if (differingRefs.length > 0) {
    const extraCount = gitServerOnlyRefs.length;
    summaryText = (
      <>
        {differingRefs.length} ref{differingRefs.length !== 1 ? "s" : ""} differ
        across git servers
        {extraCount > 0 && (
          <>
            , {extraCount} git-server-only ref{extraCount !== 1 ? "s" : ""}
          </>
        )}
      </>
    );
  } else {
    // Only git-server-only refs
    summaryText = (
      <>
        {gitServerOnlyRefs.length} ref
        {gitServerOnlyRefs.length !== 1 ? "s" : ""} on git server only
      </>
    );
  }

  return (
    <div className="bg-amber-500/5">
      {/* Summary row */}
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-amber-500/10 transition-colors text-left"
      >
        <span className="flex-1 min-w-0">{summaryText}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
      </button>

      {/* Expanded per-ref list — slightly faded amber so it trails off naturally */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 bg-amber-500/[0.03]">
          {differingRefs.slice(0, differingVisible).map((ref) => (
            <DiffRefRow
              key={ref.name}
              refItem={ref}
              cloneUrls={cloneUrls}
              urlStates={urlStates}
              pool={pool}
            />
          ))}
          {differingVisible < differingRefs.length && (
            <button
              onClick={() => setDifferingVisible((v) => v + PAGE_SIZE)}
              className="flex items-center gap-1.5 w-full py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors group"
            >
              <span className="flex-1 border-t border-dashed border-border/40 group-hover:border-border/70 transition-colors" />
              <span className="shrink-0">
                {differingRefs.length - differingVisible} more
              </span>
              <ChevronDown className="h-2.5 w-2.5 shrink-0" />
              <span className="flex-1 border-t border-dashed border-border/40 group-hover:border-border/70 transition-colors" />
            </button>
          )}

          {/* Git server only section */}
          {gitServerOnlyRefs.length > 0 && (
            <div
              className={cn(
                "space-y-1",
                differingRefs.length > 0 &&
                  "mt-2 pt-2 border-t border-border/30",
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1">
                <Server className="h-3 w-3" />
                Not on nostr (git server only)
              </p>
              {gitServerOnlyRefs.slice(0, gitOnlyVisible).map((ref) => (
                <GitServerOnlyRefRow
                  key={ref.name}
                  refItem={ref}
                  cloneUrls={cloneUrls}
                  urlStates={urlStates}
                  pool={pool}
                />
              ))}
              {gitOnlyVisible < gitServerOnlyRefs.length && (
                <button
                  onClick={() => setGitOnlyVisible((v) => v + PAGE_SIZE)}
                  className="flex items-center gap-1.5 w-full py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors group"
                >
                  <span className="flex-1 border-t border-dashed border-border/40 group-hover:border-border/70 transition-colors" />
                  <span className="shrink-0">
                    {gitServerOnlyRefs.length - gitOnlyVisible} more
                  </span>
                  <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                  <span className="flex-1 border-t border-dashed border-border/40 group-hover:border-border/70 transition-colors" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raw state event JSON modal
// ---------------------------------------------------------------------------

function RawStateEventDialog({
  event,
  open,
  onOpenChange,
}: {
  event: NostrEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Nostr state event JSON</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-md border bg-muted/40 p-4 min-h-0">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Source header: clickable row that opens the source selector
// ---------------------------------------------------------------------------

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
  graspCloneUrls,
  additionalGitServerUrls,
  urlStates,
  pool,
  selectedSource,
  onSelectSource,
  diffSummaryExternal,
  relayStateMap,
  currentRefFullName,
  currentRefIsDefault,
  onRefRevertToDefault,
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
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  urlStates: Record<string, UrlState>;
  pool?: GitGraspPool | null;
  selectedSource: string;
  onSelectSource: (source: string) => void;
  /** When true, DiffSummaryBar is rendered externally (inside ScrollArea) — skip it here */
  diffSummaryExternal?: boolean;
  relayStateMap?: Map<string, NostrEvent>;
  /** Full ref name of the currently viewed ref (e.g. "refs/heads/feature-x") */
  currentRefFullName?: string;
  /** True when the current ref is the default branch */
  currentRefIsDefault?: boolean;
  /** Called when a source change requires reverting to the default branch */
  onRefRevertToDefault?: (newSource: string) => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [rawEventOpen, setRawEventOpen] = useState(false);
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const updatePopoverStyle = useCallback(() => {
    if (!isMobile) {
      setPopoverStyle({});
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setPopoverStyle({
      width: `calc(100vw - ${margin * 2}px)`,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      marginLeft: `-${rect.left - margin}px`,
    });
  }, [isMobile]);

  useEffect(() => {
    if (!selectorOpen) return;
    updatePopoverStyle();
    window.addEventListener("resize", updatePopoverStyle);
    return () => window.removeEventListener("resize", updatePopoverStyle);
  }, [selectorOpen, updatePopoverStyle]);

  const isLoading = repoState === undefined || !repoRelayEose;
  const hasProblems = mismatchCount > 0 || stateBehindGit;

  // Resolve "default" → "nostr" or a concrete git server URL.
  const aheadServerUrl =
    poolWarning?.kind === "state-behind-git" ? poolWarning.gitServerUrl : null;
  const effectiveSource = deriveEffectiveSource(
    selectedSource,
    stateBehindGit,
    isNoState,
    winnerUrl,
    aheadServerUrl,
  );
  const effectiveSourceIsGitServer = effectiveSource !== "nostr";

  // A URL (not "default"/"nostr") means the user manually picked a git server
  const isManualGitSource =
    selectedSource !== "default" && selectedSource !== "nostr";

  const sourceLabel = effectiveSourceIsGitServer
    ? selectedSource === "default"
      ? `default (${gitServerDomain(effectiveSource)})`
      : shortServerLabel(effectiveSource)
    : "nostr";
  const sourceIsNostr = !effectiveSourceIsGitServer;

  const defaultBranchName = useMemo(() => {
    return refsWithStatus.find((r) => r.isDefault && r.isBranch)?.name;
  }, [refsWithStatus]);

  // How far ahead the git server's default branch is relative to the nostr state
  const gitAheadDistance = useMemo(() => {
    if (
      poolWarning?.kind !== "state-behind-git" ||
      !poolWarning.gitCommitterDate ||
      !stateCreatedAt
    )
      return null;
    try {
      return formatDistanceStrict(
        new Date(poolWarning.gitCommitterDate * 1000),
        new Date(stateCreatedAt * 1000),
      );
    } catch {
      return null;
    }
  }, [poolWarning, stateCreatedAt]);

  // Only show DiffSummaryBar when not viewing a manually-selected git server
  const showDiffSummary =
    hasProblems && !isLoading && !isManualGitSource && !diffSummaryExternal;

  return (
    <>
      {/* Clickable source row — opens source selector */}
      <Popover open={selectorOpen} onOpenChange={setSelectorOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            className={cn(
              "flex items-center gap-2 px-3 py-2 w-full text-left text-[11px] transition-colors",
              hasProblems && !isManualGitSource
                ? "bg-amber-500/5 hover:bg-amber-500/10"
                : "border-b border-border/40 bg-muted/20 hover:bg-accent/40",
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
                  hasProblems && !isManualGitSource
                    ? "text-amber-500"
                    : isManualGitSource
                      ? "text-blue-500 dark:text-blue-400"
                      : "text-muted-foreground/60",
                )}
              />
            )}

            <span className="text-muted-foreground/60 shrink-0">Source</span>

            {/* Source label + subtle chevron */}
            <span className="flex items-center gap-0.5 min-w-0 overflow-hidden">
              <span
                className={cn(
                  "font-medium truncate max-w-[120px]",
                  isLoading
                    ? "text-muted-foreground/50"
                    : isManualGitSource
                      ? "text-blue-600 dark:text-blue-400"
                      : sourceIsNostr
                        ? "text-purple-600 dark:text-purple-400"
                        : hasProblems
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground/80",
                )}
              >
                {sourceLabel}
              </span>
              <ChevronDown
                className={cn(
                  "h-3 w-3 shrink-0 transition-transform",
                  selectorOpen && "rotate-180",
                  isLoading
                    ? "text-muted-foreground/30"
                    : isManualGitSource
                      ? "text-blue-500/60 dark:text-blue-400/60"
                      : sourceIsNostr
                        ? "text-purple-500/60 dark:text-purple-400/60"
                        : hasProblems
                          ? "text-amber-500/60"
                          : "text-muted-foreground/40",
                )}
              />
            </span>

            {/* Raw state event button — stops propagation so it doesn't open the source selector */}
            {repoState && sourceIsNostr && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setRawEventOpen(true);
                }}
                className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                title="View raw Nostr state event"
              >
                <Braces className="h-3 w-3" />
              </span>
            )}

            {/* Right-side status badge */}
            {hasProblems && !isManualGitSource ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto flex items-center gap-1 shrink-0 cursor-default">
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {stateBehindGit
                        ? sourceIsNostr
                          ? "git servers ahead of nostr"
                          : "ahead of nostr"
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
                      {sourceIsNostr
                        ? "Git servers have commits not yet announced on Nostr. You are viewing the Nostr state."
                        : "The git server has commits not yet announced on Nostr. Showing the git server's latest data."}
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
            ) : isNoState && !isManualGitSource ? (
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
                  The maintainer hasn't published a Nostr state for this repo
                  yet. Showing git server data only.
                </TooltipContent>
              </Tooltip>
            ) : isManualGitSource ? (
              <span className="ml-auto text-[10px] text-blue-600/70 dark:text-blue-400/60 shrink-0">
                manual
              </span>
            ) : !isLoading && sourceIsNostr ? (
              <span className="ml-auto text-muted-foreground/50 shrink-0">
                all git servers in sync
              </span>
            ) : null}
          </button>
        </PopoverTrigger>

        <PopoverContent
          className={cn(
            "p-0 overflow-hidden z-50",
            isMobile ? "w-screen" : "w-[480px]",
          )}
          align="start"
          side="bottom"
          sideOffset={0}
          avoidCollisions={!isMobile}
          style={popoverStyle}
        >
          <SourceSelector
            selectedSource={selectedSource}
            onSelectSource={(src) => {
              onSelectSource(src);
              setSelectorOpen(false);
            }}
            repoState={repoState}
            repoRelayEose={repoRelayEose}
            stateCreatedAt={stateCreatedAt}
            urlStates={urlStates}
            cloneUrls={cloneUrls}
            graspCloneUrls={graspCloneUrls}
            additionalGitServerUrls={additionalGitServerUrls}
            stateBehindGit={stateBehindGit}
            poolWarning={poolWarning}
            pool={pool}
            relayStateMap={relayStateMap}
            currentRefFullName={currentRefFullName}
            currentRefIsDefault={currentRefIsDefault}
            onRefRevertToDefault={(newSource) => {
              onRefRevertToDefault?.(newSource);
              setSelectorOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {/* Subtle expandable diff summary — only for nostr source */}
      {showDiffSummary && (
        <DiffSummaryBar
          refsWithStatus={refsWithStatus}
          stateBehindGit={stateBehindGit}
          defaultBranchName={defaultBranchName}
          gitAheadDistance={gitAheadDistance}
          cloneUrls={cloneUrls}
          urlStates={urlStates}
          pool={pool}
          sourceIsNostr={sourceIsNostr}
        />
      )}

      {/* Raw state event dialog */}
      {repoState && sourceIsNostr && (
        <RawStateEventDialog
          event={repoState.event}
          open={rawEventOpen}
          onOpenChange={setRawEventOpen}
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
  selectedSource: selectedSourceProp,
  onSourceChange,
  onRefAndSourceChange,
  repoState,
  repoRelayEose,
  relayStateMap,
  loading,
  stateBehindGit = false,
  poolWarning,
  winnerUrl,
  stateCreatedAt,
  urlStates = {},
  cloneUrls = [],
  graspCloneUrls = [],
  additionalGitServerUrls = [],
  pool,
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // "default" = let the pool decide (current behaviour — git server when ahead, nostr otherwise)
  // "nostr"   = explicitly force nostr state comparison even when stateBehindGit
  // <url>     = compare against a specific git server's infoRefs
  //
  // Controlled when selectedSourceProp is provided; falls back to "default".
  const selectedSource = selectedSourceProp ?? "default";
  const setSelectedSource = (src: string) => onSourceChange?.(src);

  // Resolve effective source and compute per-ref status against it.
  const {
    effectiveSource,
    refsWithStatus,
    branches,
    tags: tagsUnsorted,
    mismatchCount,
  } = useRefsWithStatus({
    refs,
    selectedSource,
    repoState,
    repoRelayEose,
    relayStateMap,
    stateBehindGit,
    poolWarning,
    winnerUrl,
    urlStates,
    cloneUrls,
  });
  const isNoState = repoRelayEose && repoState === null;

  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  // Recompute popover position/width on open and resize.
  const updatePopoverStyle = useCallback(() => {
    if (!isMobile) {
      setPopoverStyle({});
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setPopoverStyle({
      width: `calc(100vw - ${margin * 2}px)`,
      maxWidth: `calc(100vw - ${margin * 2}px)`,
      marginLeft: `-${rect.left - margin}px`,
    });
  }, [isMobile]);

  useEffect(() => {
    if (!open) return;
    updatePopoverStyle();
    window.addEventListener("resize", updatePopoverStyle);
    return () => window.removeEventListener("resize", updatePopoverStyle);
  }, [open, updatePopoverStyle]);

  // On mobile, scroll the trigger into view when the dropdown opens.
  useEffect(() => {
    if (!open || !isMobile) return;
    const el = triggerRef.current;
    if (!el) return;
    const id = setTimeout(() => {
      const stickyHeader = document.querySelector("header.sticky");
      const headerHeight = stickyHeader
        ? stickyHeader.getBoundingClientRect().height
        : 0;
      const triggerTop =
        el.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo({ top: triggerTop, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(id);
  }, [open, isMobile]);

  // Tags in the popover are sorted newest-first by version.
  const tags = useMemo(
    () =>
      [...tagsUnsorted].sort((a, b) => compareTagsNewestFirst(a.name, b.name)),
    [tagsUnsorted],
  );

  // Filter by search
  const lowerSearch = search.toLowerCase();
  const filteredBranches = search
    ? branches.filter((b) => b.name.toLowerCase().includes(lowerSearch))
    : branches;
  const filteredTags = search
    ? tags.filter((t) => t.name.toLowerCase().includes(lowerSearch))
    : tags;

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

  // Full ref name for the current ref — used by the source selector to detect
  // when a server doesn't have the current ref.
  const currentRefFullName = currentRefObj
    ? currentRefObj.isBranch
      ? `refs/heads/${currentRef}`
      : `refs/tags/${currentRef}`
    : undefined;
  const currentRefIsDefault = currentRefObj?.isDefault ?? false;

  // Default branch name — used to revert when switching to a source that
  // doesn't have the current ref.
  const defaultBranchRef = refs.find((r) => r.isDefault && r.isBranch);
  const handleRefRevertToDefault = useCallback(
    (newSource: string) => {
      if (defaultBranchRef) {
        if (onRefAndSourceChange) {
          // Atomic: navigate to default branch + apply source in one step
          onRefAndSourceChange(defaultBranchRef.name, newSource);
        } else {
          // Fallback: apply source change then ref change separately
          onSourceChange?.(newSource);
          if (defaultBranchRef.name !== currentRef) {
            onRefChange(defaultBranchRef.name);
          }
        }
      } else {
        // No default branch known — just apply the source change
        onSourceChange?.(newSource);
      }
    },
    [
      defaultBranchRef,
      currentRef,
      onRefChange,
      onSourceChange,
      onRefAndSourceChange,
    ],
  );

  const showStatusIcon =
    currentStatus !== "loading" &&
    currentStatus !== "no-state" &&
    currentStatus !== "not-on-server";

  // Amber trigger border when there are genuine mismatches or state is behind
  const showAmberTrigger = mismatchCount > 0 || stateBehindGit;

  // A URL (not "nostr") means the effective source is a git server.
  // isManualGitSource is true only when the user explicitly chose a URL
  // (not when "default" resolved to a git server) — used for the "manual" badge.
  const isManualGitSource =
    selectedSource !== "default" && selectedSource !== "nostr";
  const effectiveSourceIsGitServer = effectiveSource !== "nostr";

  // Source prefix in trigger button — show the git server domain when the
  // effective source is a git server (manual or auto-resolved from "default").
  const showGitPrefix = effectiveSourceIsGitServer;
  const sourcePrefix = effectiveSourceIsGitServer
    ? gitServerDomain(effectiveSource)
    : null;

  const handleSelect = (refName: string) => {
    // If the chosen ref is not on the currently selected server, auto-switch
    // to the best source that has it: default → nostr → first other server URL.
    const chosenRef = refsWithStatus.find((r) => r.name === refName);
    if (chosenRef?.status === "not-on-server") {
      const prefix = chosenRef.isBranch ? "refs/heads/" : "refs/tags/";
      const fullRefName = `${prefix}${refName}`;

      // "default" source always has the ref (pool winner) — prefer it.
      const defaultHasRef = cloneUrls.some((url) => {
        const infoRefs = urlStates[url]?.infoRefs;
        if (!infoRefs) return false;
        return (
          infoRefs.refs[fullRefName] !== undefined ||
          infoRefs.refs[`${fullRefName}^{}`] !== undefined
        );
      });

      if (defaultHasRef || selectedSource === "default") {
        // Remove source param — "default" is the no-param state.
        setSelectedSource("default");
      } else if (repoState !== null && repoState !== undefined) {
        // Check if Nostr state has this ref.
        const nostrHasRef = repoState.refs.some((r) => r.name === fullRefName);
        if (nostrHasRef) {
          setSelectedSource("nostr");
        } else {
          // Try other server URLs in order.
          const otherUrl = cloneUrls.find((url) => {
            if (url === selectedSource) return false;
            const infoRefs = urlStates[url]?.infoRefs;
            if (!infoRefs) return false;
            return (
              infoRefs.refs[fullRefName] !== undefined ||
              infoRefs.refs[`${fullRefName}^{}`] !== undefined
            );
          });
          if (otherUrl) setSelectedSource(otherUrl);
          else setSelectedSource("default");
        }
      } else {
        setSelectedSource("default");
      }
    }

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
            showAmberTrigger && !isManualGitSource
              ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
              : isManualGitSource
                ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
                : "border-border/60 bg-background",
          )}
        >
          {/* Source prefix — shown when source is a git server */}
          {showGitPrefix && sourcePrefix && (
            <>
              <span
                className={cn(
                  "truncate max-w-[100px] shrink-0",
                  isManualGitSource
                    ? "text-blue-600 dark:text-blue-400"
                    : showAmberTrigger
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
              {currentStatus === "old-state" && (
                <ShieldAlert className="h-3.5 w-3.5 text-sky-500" />
              )}
              {currentStatus === "state-behind" && (
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              )}
              {currentStatus === "git-server-only" && (
                <ShieldQuestion className="h-3.5 w-3.5 text-muted-foreground/50" />
              )}
            </span>
          ) : mismatchCount > 0 && !isManualGitSource ? (
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 ml-0.5" />
          ) : null}

          <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground/60 ml-0.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className={cn("p-0 z-40", isMobile ? "w-screen" : "w-[420px]")}
        align="start"
        sideOffset={6}
        style={popoverStyle}
        avoidCollisions={!isMobile}
      >
        {/* Source header — clickable, opens source selector */}
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
          graspCloneUrls={graspCloneUrls}
          additionalGitServerUrls={additionalGitServerUrls}
          urlStates={urlStates}
          pool={pool}
          selectedSource={selectedSource}
          onSelectSource={setSelectedSource}
          diffSummaryExternal
          relayStateMap={relayStateMap}
          currentRefFullName={currentRefFullName}
          currentRefIsDefault={currentRefIsDefault}
          onRefRevertToDefault={handleRefRevertToDefault}
        />

        <ScrollArea
          type="always"
          style={{
            maxHeight:
              "calc(var(--radix-popover-content-available-height) - 80px)",
          }}
        >
          {/* Diff summary — inside scroll area so expanding it doesn't overflow the viewport */}
          {(mismatchCount > 0 || stateBehindGit) &&
            repoState !== undefined &&
            repoRelayEose &&
            !isManualGitSource && (
              <DiffSummaryBar
                refsWithStatus={refsWithStatus}
                stateBehindGit={stateBehindGit}
                defaultBranchName={
                  refsWithStatus.find((r) => r.isDefault && r.isBranch)?.name
                }
                gitAheadDistance={(() => {
                  if (
                    poolWarning?.kind !== "state-behind-git" ||
                    !poolWarning.gitCommitterDate ||
                    !stateCreatedAt
                  )
                    return null;
                  try {
                    return formatDistanceStrict(
                      new Date(poolWarning.gitCommitterDate * 1000),
                      new Date(stateCreatedAt * 1000),
                    );
                  } catch {
                    return null;
                  }
                })()}
                cloneUrls={cloneUrls}
                urlStates={urlStates}
                pool={pool}
                sourceIsNostr={!effectiveSourceIsGitServer}
              />
            )}

          {/* Search input */}
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
                      effectiveSource={effectiveSource}
                      pool={pool}
                      urlStates={urlStates}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Separator between branches and tags */}
            {filteredBranches.length > 0 && <Separator className="my-2" />}

            {/* Tags section */}
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
                      effectiveSource={effectiveSource}
                      pool={pool}
                      urlStates={urlStates}
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

        {/* Footer legend — shown for default/nostr source with state */}
        {repoState !== null &&
          repoState !== undefined &&
          !isManualGitSource && (
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
        {/* Footer legend for manually-selected git server source */}
        {isManualGitSource && (
          <>
            <Separator />
            <div className="px-3 py-2 flex items-center gap-3 text-[11px] text-muted-foreground/60 flex-wrap">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-emerald-500/70" />
                matches nostr
              </span>
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-sky-500/70" />
                older nostr state
              </span>
              <span className="flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-amber-500/70" />
                differs from nostr
              </span>
              <span className="flex items-center gap-1">
                <Minus className="h-3 w-3 text-muted-foreground/30" />
                not on this server
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
