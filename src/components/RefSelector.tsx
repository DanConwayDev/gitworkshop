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
  HelpCircle,
  Copy,
  Minus,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { formatDistanceStrict } from "date-fns";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { GitRef } from "@/hooks/useGitExplorer";
import type { RepositoryState } from "@/casts/RepositoryState";
import type {
  PoolWarning,
  UrlState,
  UrlRefStatus,
  UrlErrorKind,
} from "@/lib/git-grasp-pool/types";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import { GraspLogo } from "@/components/GraspLogo";
import { UserAvatar, UserName } from "@/components/UserAvatar";
import { graspCloneUrlNpub } from "@/lib/nip34";

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

/**
 * Status of a ref's verification against the signed state event.
 *
 * - "verified"        : state event exists and this ref's commit matches
 * - "mismatch"        : state event exists but declares a different commit for this ref
 * - "state-behind"    : git server is ahead of the signed state (expected lag, not suspicious)
 * - "git-server-only" : state event exists but doesn't include this ref
 * - "not-on-server"   : ref doesn't exist on the selected git server source
 * - "no-state"        : no state event was found (after EOSE)
 * - "loading"         : still waiting for state event data
 */
type RefStatus =
  | "verified"
  | "mismatch"
  | "state-behind"
  | "git-server-only"
  | "not-on-server"
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
  urlStates: Record<string, UrlState>,
  cloneUrls: string[],
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
    // This ref exists on the git server but has never been published to the
    // Nostr state — always flag it as git-server-only, even when the git
    // server is ahead of the signed state on the default branch.
    return { status: "git-server-only" };
  }

  // When the git server is confirmed ahead of the signed state, the default
  // branch is always "state-behind" — even if its hash happens to match the
  // state ref, the HEAD comparison already proved the server is ahead.
  if (stateBehindGit && ref.isDefault) {
    return { status: "state-behind", stateCommit: stateRef.commitId };
  }

  // Use the pool's pre-computed per-URL ref statuses as the authoritative
  // source. The pool already handles annotated tag peeling, old-ngit OID
  // fallback, and cross-server discrepancies — re-computing here from only
  // the winner's infoRefs would miss servers that are behind the state.
  //
  // Collect statuses for this ref across all ok servers.
  const serverStatuses = cloneUrls
    .map((url) => urlStates[url]?.refStatus[fullRefName])
    .filter((s): s is UrlRefStatus => s !== undefined);

  if (serverStatuses.length > 0) {
    // If any server is behind or ahead of the state, surface as mismatch.
    const hasMismatch = serverStatuses.some(
      (s) => s === "behind" || s === "ahead",
    );
    if (hasMismatch) {
      if (stateBehindGit)
        return { status: "state-behind", stateCommit: stateRef.commitId };
      return { status: "mismatch", stateCommit: stateRef.commitId };
    }

    // All servers that have reported are "match" (or "connected"/"error" which
    // we ignore for verification purposes) and at least one confirmed match.
    const anyMatch = serverStatuses.some((s) => s === "match");
    const allSettled = serverStatuses.every(
      (s) => s === "match" || s === "error" || s === "connected",
    );
    if (allSettled && anyMatch) {
      return { status: "verified" };
    }

    // If not all pending (unknown/connected), fall through to the state
    // comparison below so we show something useful while the pool fetches.
  }

  // Fallback: pool hasn't computed refStatus yet (infoRefs still in flight).
  // Compare the winner's commit directly against the state event.
  function commitsMatch(a: string, b: string): boolean {
    return a === b || a.startsWith(b) || b.startsWith(a);
  }

  if (commitsMatch(ref.hash, stateRef.commitId)) {
    return { status: "verified" };
  }

  // Older ngit versions stored the tag object OID in the state event instead
  // of the peeled commit. The pool handles this the same way (pool.ts:183-189).
  // If the state's commitId matches the raw tag object OID, treat as verified.
  if (ref.rawTagOid && commitsMatch(ref.rawTagOid, stateRef.commitId)) {
    return { status: "verified" };
  }

  // When the git server is confirmed ahead of the signed state, a commit
  // difference on any other ref is expected — use a softer status.
  if (stateBehindGit)
    return { status: "state-behind", stateCommit: stateRef.commitId };

  return { status: "mismatch", stateCommit: stateRef.commitId };
}

/**
 * Compute ref status when a specific git server is selected as the source.
 * Nostr state is still the authority — we compare this server's commit
 * against the Nostr state, but only using data from this one server.
 * Refs absent from this server get "not-on-server".
 */
function getRefStatusForServer(
  ref: GitRef,
  serverUrlState: UrlState,
  repoState: RepositoryState | null | undefined,
  repoRelayEose: boolean,
): { status: RefStatus; stateCommit?: string } {
  const prefix = ref.isBranch ? "refs/heads/" : "refs/tags/";
  const fullRefName = `${prefix}${ref.name}`;
  const peeledRefName = `${fullRefName}^{}`;

  // Check if this ref exists on the selected server
  const serverCommit =
    serverUrlState.infoRefs?.refs[peeledRefName] ??
    serverUrlState.infoRefs?.refs[fullRefName];

  if (!serverCommit) {
    return { status: "not-on-server" };
  }

  // Nostr state still loading
  if (repoState === undefined || !repoRelayEose) {
    return { status: "loading" };
  }

  // No Nostr state
  if (repoState === null) {
    return { status: "no-state" };
  }

  // Find this ref in the Nostr state
  const stateRef = repoState.refs.find((r) => r.name === fullRefName);
  if (!stateRef) {
    return { status: "git-server-only" };
  }

  // Use the pool's pre-computed refStatus for this server if available
  const poolStatus = serverUrlState.refStatus[fullRefName];
  if (poolStatus === "match") return { status: "verified" };
  if (poolStatus === "behind" || poolStatus === "ahead") {
    return { status: "mismatch", stateCommit: stateRef.commitId };
  }

  // Fallback: direct commit comparison
  function commitsMatch(a: string, b: string): boolean {
    return a === b || a.startsWith(b) || b.startsWith(a);
  }

  if (commitsMatch(serverCommit, stateRef.commitId)) {
    return { status: "verified" };
  }

  if (ref.rawTagOid && commitsMatch(ref.rawTagOid, stateRef.commitId)) {
    return { status: "verified" };
  }

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
  selectedSource,
}: {
  refWithStatus: RefWithStatus;
  selectedSource: string; // "nostr" or a URL
}) {
  const serverLabel =
    selectedSource !== "nostr" ? gitServerDomain(selectedSource) : null;

  switch (refWithStatus.status) {
    case "verified":
      return (
        <span>
          {serverLabel
            ? `${serverLabel} matches the Nostr state for this ref`
            : "Matches Nostr state — the maintainer's published state matches this git server"}
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
            but {serverLabel ? serverLabel : "the git server"} has{" "}
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
  selectedSource,
}: {
  refWithStatus: RefWithStatus;
  isSelected: boolean;
  onSelect: () => void;
  selectedSource: string;
}) {
  const isAbsent = refWithStatus.status === "not-on-server";
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
        isAbsent && "opacity-50",
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
          isAbsent && "text-muted-foreground",
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
          <StatusTooltipText
            refWithStatus={refWithStatus}
            selectedSource={selectedSource}
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
 * Only shown when selectedSource === "nostr".
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

// ---------------------------------------------------------------------------
// Source selector dropdown — replaces GitServerStatus panel
// ---------------------------------------------------------------------------

/** Condensed npub: "npub1abc…56" */
function condenseNpub(npub: string): string {
  if (npub.length <= 12) return npub;
  return npub.slice(0, 8) + "…" + npub.slice(-2);
}

function condenseGraspUrl(url: string): string {
  const npub = graspCloneUrlNpub(url);
  if (!npub) return url;
  return url.replace(npub, condenseNpub(npub));
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

/** Status dot for a server row in the source selector */
function SourceServerDot({
  status,
  gitIsAhead,
}: {
  status: UrlRefStatus;
  gitIsAhead?: boolean;
}) {
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
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      );
    case "connected":
    case "unknown":
      return (
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
      );
  }
}

/** One-word right-aligned status label for a server row */
function SourceServerLabel({
  status,
  hasState,
  gitIsAhead,
}: {
  status: UrlRefStatus;
  hasState: boolean;
  gitIsAhead?: boolean;
}) {
  if (gitIsAhead && hasState) {
    switch (status) {
      case "match":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            behind
          </span>
        );
      case "behind":
        return (
          <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
            unsigned
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
          {hasState ? "matches nostr" : "in sync"}
        </span>
      );
    case "behind":
      return (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          differs
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
        <span className="text-[10px] text-muted-foreground/60 shrink-0">
          error
        </span>
      );
    case "connected":
      return (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">
          checking…
        </span>
      );
    case "unknown":
      return (
        <span className="text-[10px] text-muted-foreground/40 shrink-0">…</span>
      );
  }
}

/**
 * A single git server row in the source selector dropdown.
 * Clicking selects it as the verification source (if selectable).
 */
function SourceServerRow({
  url,
  urlState,
  isGrasp,
  isSelected,
  hasState,
  gitIsAhead,
  stateCreatedAt,
  gitCommitterDate,
  pool,
  onSelect,
}: {
  url: string;
  urlState: UrlState | undefined;
  isGrasp: boolean;
  isSelected: boolean;
  hasState: boolean;
  gitIsAhead: boolean;
  stateCreatedAt?: number;
  gitCommitterDate?: number;
  pool?: GitGraspPool | null;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [serverCommitTs, setServerCommitTs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const connectionStatus = urlState?.status ?? "untested";
  const hasInfoRefs = !!urlState?.infoRefs;
  const isError =
    connectionStatus === "permanent-failure" || connectionStatus === "error";
  const isLoading = !isError && !hasInfoRefs;
  const isSelectable = hasInfoRefs && !isError;

  // For the server row we show overall connection health, not per-ref status
  // (per-ref status is shown in the ref list itself once selected)
  const overallStatus: UrlRefStatus = isError
    ? "error"
    : isLoading
      ? "unknown"
      : (() => {
          if (!urlState) return "unknown";
          const statuses = Object.values(urlState.refStatus);
          if (statuses.length === 0) return "connected";
          if (statuses.some((s) => s === "behind" || s === "ahead")) {
            return gitIsAhead ? "behind" : "behind";
          }
          if (
            statuses.every(
              (s) => s === "match" || s === "error" || s === "connected",
            )
          ) {
            if (statuses.some((s) => s === "match")) return "match";
          }
          return "connected";
        })();

  const needsTimestampCheck =
    overallStatus === "behind" &&
    hasState &&
    !gitIsAhead &&
    !!pool &&
    stateCreatedAt !== undefined;

  useEffect(() => {
    if (!needsTimestampCheck || !urlState) return;
    // Find any differing commit to check its timestamp
    const differingEntry = Object.entries(urlState.refCommits).find(
      ([refName]) => {
        const s = urlState.refStatus[refName];
        return s === "behind" || s === "ahead";
      },
    );
    if (!differingEntry) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    pool!
      .getSingleCommit(differingEntry[1], ac.signal)
      .then((commit) => {
        if (ac.signal.aborted || !commit) return;
        setServerCommitTs(
          commit.committer?.timestamp ?? commit.author.timestamp,
        );
      })
      .catch(() => {});

    return () => ac.abort();
  }, [needsTimestampCheck, urlState, pool]);

  const refinedBehindLabel: "behind nostr" | "diverged" | "differs" =
    !needsTimestampCheck
      ? "differs"
      : serverCommitTs === null
        ? "differs"
        : serverCommitTs < stateCreatedAt!
          ? "behind nostr"
          : "diverged";

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const npub = isGrasp ? (graspCloneUrlNpub(url) ?? undefined) : undefined;
  const pubkey = npub ? npubToPubkey(npub) : undefined;
  const displayUrl = isGrasp ? condenseGraspUrl(url) : url;

  const serverIsUnsignedAhead =
    overallStatus === "behind" && hasState && gitIsAhead;
  const serverIsSignedOnly =
    overallStatus === "match" && hasState && gitIsAhead;

  // Highlight color for selected state
  const selectedHighlight = isSelected
    ? gitIsAhead
      ? ("amber" as const)
      : ("emerald" as const)
    : null;

  return (
    <button
      onClick={isSelectable ? onSelect : undefined}
      disabled={!isSelectable}
      className={cn(
        "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors relative",
        isSelectable ? "cursor-pointer" : "cursor-not-allowed opacity-60",
        selectedHighlight === "emerald" &&
          "bg-emerald-500/5 border-l-2 border-emerald-500 pl-[14px] hover:bg-emerald-500/10",
        selectedHighlight === "amber" &&
          "bg-amber-500/5 border-l-2 border-amber-500 pl-[14px] hover:bg-amber-500/10",
        !selectedHighlight && isSelectable && "hover:bg-accent/30",
      )}
    >
      <SourceServerDot status={overallStatus} gitIsAhead={gitIsAhead} />

      <div className="min-w-0 flex-1">
        {/* URL + identity bubble */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <p
            className={cn(
              "font-mono text-[10px] break-all leading-snug",
              isError ? "text-muted-foreground/60" : "text-foreground/80",
            )}
            title={url}
          >
            {displayUrl}
          </p>
          {isGrasp && (pubkey ?? npub) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border/60 bg-popover px-1.5 py-0.5 shadow-sm whitespace-nowrap font-sans leading-none shrink-0",
                isError && "opacity-60 grayscale",
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

        {/* Sub-line detail */}
        {serverIsUnsignedAhead && (
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-0.5">
            unsigned commits ahead of nostr state
            {gitCommitterDate && (
              <span className="text-muted-foreground/70">
                {" "}
                (
                {safeFormatDistanceToNow(gitCommitterDate, { addSuffix: true })}
                )
              </span>
            )}
          </p>
        )}
        {serverIsSignedOnly && (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            serving nostr state · another server has newer unsigned commits
          </p>
        )}
        {overallStatus === "behind" && !gitIsAhead && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {refinedBehindLabel === "behind nostr"
              ? "commit older than nostr state"
              : refinedBehindLabel === "diverged"
                ? "commit diverged from nostr state"
                : "differs from nostr state"}
          </p>
        )}
        {isError && (
          <ErrorDetail
            errorKind={urlState?.lastErrorKind}
            usesProxy={urlState?.usesProxy ?? false}
          />
        )}
        {isLoading && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            fetching…
          </p>
        )}
        {!isError && !isLoading && overallStatus === "connected" && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            reachable — waiting for state…
          </p>
        )}
      </div>

      {urlState?.usesProxy && <ProxyBadge />}

      {/* Copy URL icon — only on hover, stops propagation so it doesn't select */}
      {isSelectable && (
        <span
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground mt-0.5"
          onClick={handleCopy}
          aria-label="Copy URL"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </span>
      )}

      {/* Right-aligned status label */}
      <SourceServerLabel
        status={overallStatus}
        hasState={hasState}
        gitIsAhead={gitIsAhead}
      />
    </button>
  );
}

/**
 * The source selector dropdown panel — shown inside a nested Popover
 * triggered from the SourceHeader row.
 *
 * Shows:
 *   - Nostr state row (always first, always selectable)
 *   - Grasp server rows (if any)
 *   - Other git server rows
 *
 * Clicking a selectable row sets it as the verification source.
 */
function SourceSelectorPanel({
  selectedSource,
  onSelectSource,
  repoState,
  repoRelayEose,
  stateCreatedAt,
  urlStates,
  cloneUrls,
  graspCloneUrls,
  additionalGitServerUrls,
  stateBehindGit,
  poolWarning,
  pool,
}: {
  selectedSource: string;
  onSelectSource: (source: string) => void;
  repoState: RepositoryState | null | undefined;
  repoRelayEose: boolean;
  stateCreatedAt?: number;
  urlStates: Record<string, UrlState>;
  cloneUrls: string[];
  graspCloneUrls: string[];
  additionalGitServerUrls: string[];
  stateBehindGit: boolean;
  poolWarning?: PoolWarning | null;
  pool?: GitGraspPool | null;
}) {
  const hasState =
    repoRelayEose && repoState !== null && repoState !== undefined;
  const gitIsAhead = poolWarning?.kind === "state-behind-git";
  const gitCommitterDate =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitCommitterDate
      : undefined;

  const usesGrasp = graspCloneUrls.length > 0;
  const graspUrls = cloneUrls.filter((u) => graspCloneUrls.includes(u));
  const otherUrls = cloneUrls.filter((u) =>
    additionalGitServerUrls.includes(u),
  );

  const nostrSubLine = useMemo(() => {
    if (repoState === undefined || !repoRelayEose) return "Checking relays…";
    if (repoState === null) return "No signed state published";
    if (stateCreatedAt) {
      return `Published ${safeFormatDistanceToNow(stateCreatedAt, { addSuffix: true })}`;
    }
    return "Signed state available";
  }, [repoState, repoRelayEose, stateCreatedAt]);

  // When the default source is not nostr (git server is ahead or no state),
  // show "default" as the first option and "nostr" as an explicit override.
  // When default IS nostr, only show the nostr row (labelled "nostr").
  const defaultIsNostr = !stateBehindGit && repoState !== null;

  // Domain of the git server that is ahead (used in the default row label)
  const gitAheadDomain =
    poolWarning?.kind === "state-behind-git" && poolWarning.gitServerUrl
      ? gitServerDomain(poolWarning.gitServerUrl)
      : null;

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

  return (
    <div className="w-full">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border/40">
        <p className="text-xs font-semibold text-foreground">
          Verification source
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Select which source to compare refs against the Nostr state
        </p>
      </div>

      <ScrollArea className="max-h-[360px]">
        <div className="py-1">
          {/* Default row — always first */}
          <button
            onClick={() => onSelectSource("default")}
            className={cn(
              "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors cursor-pointer",
              selectedSource === "default"
                ? stateBehindGit
                  ? "bg-amber-500/5 border-l-2 border-amber-500 pl-[14px] hover:bg-amber-500/10"
                  : "bg-purple-500/5 border-l-2 border-purple-500 pl-[14px] hover:bg-purple-500/10"
                : "hover:bg-accent/30",
            )}
          >
            <Radio
              className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
                repoState === undefined || !repoRelayEose
                  ? "text-muted-foreground/40"
                  : stateBehindGit
                    ? "text-amber-500"
                    : repoState === null
                      ? "text-muted-foreground/40"
                      : "text-purple-500 dark:text-purple-400",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground/90 text-[11px]">
                {stateBehindGit
                  ? gitAheadDomain
                    ? `default (${gitAheadDomain})`
                    : "default"
                  : "nostr"}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                {stateBehindGit
                  ? gitAheadDistance
                    ? `because default branch is ${gitAheadDistance} ahead of nostr`
                    : "default branch is ahead of nostr state"
                  : repoState === null
                    ? "Git server (no nostr state)"
                    : `${nostrSubLine}`}
              </p>
            </div>
            <span
              className={cn(
                "text-[10px] shrink-0",
                repoState === null || !repoRelayEose
                  ? "text-muted-foreground/40"
                  : stateBehindGit
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-purple-600 dark:text-purple-400",
              )}
            >
              {repoState === undefined || !repoRelayEose
                ? "loading"
                : repoState === null
                  ? "no state"
                  : stateBehindGit
                    ? "git ahead"
                    : "authority"}
            </span>
          </button>

          {/* Explicit nostr row — only shown when default is NOT nostr */}
          {!defaultIsNostr && (
            <button
              onClick={() => onSelectSource("nostr")}
              className={cn(
                "w-full text-left flex items-start gap-2.5 px-4 py-2 text-xs group transition-colors cursor-pointer",
                selectedSource === "nostr"
                  ? "bg-purple-500/5 border-l-2 border-purple-500 pl-[14px] hover:bg-purple-500/10"
                  : "hover:bg-accent/30",
              )}
            >
              <Radio
                className={cn(
                  "h-3.5 w-3.5 shrink-0 mt-0.5",
                  repoState === undefined || !repoRelayEose
                    ? "text-muted-foreground/40"
                    : repoState === null
                      ? "text-muted-foreground/40"
                      : "text-purple-500 dark:text-purple-400",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground/90 text-[11px]">
                  nostr
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {nostrSubLine}
                </p>
              </div>
              <span
                className={cn(
                  "text-[10px] shrink-0",
                  repoState === null || !repoRelayEose
                    ? "text-muted-foreground/40"
                    : "text-purple-600 dark:text-purple-400",
                )}
              >
                {repoState === undefined || !repoRelayEose
                  ? "loading"
                  : repoState === null
                    ? "no state"
                    : "signed state"}
              </span>
            </button>
          )}
        </div>

        {/* Grasp servers */}
        {usesGrasp && graspUrls.length > 0 && (
          <>
            <Separator />
            <div className="py-1">
              <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                <GraspLogo className="h-3 w-3 text-pink-500" />
                Grasp Servers
              </div>
              {graspUrls.map((url) => (
                <SourceServerRow
                  key={url}
                  url={url}
                  urlState={urlStates[url]}
                  isGrasp={true}
                  isSelected={selectedSource === url}
                  hasState={hasState}
                  gitIsAhead={gitIsAhead}
                  stateCreatedAt={stateCreatedAt}
                  gitCommitterDate={gitCommitterDate}
                  pool={pool}
                  onSelect={() => onSelectSource(url)}
                />
              ))}
            </div>
          </>
        )}

        {/* Separator between sections */}
        {usesGrasp && otherUrls.length > 0 && <Separator />}

        {/* Other git servers */}
        {otherUrls.length > 0 && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Server className="h-3 w-3" />
              {usesGrasp ? "Other Git Servers" : "Git Servers"}
            </div>
            {otherUrls.map((url) => (
              <SourceServerRow
                key={url}
                url={url}
                urlState={urlStates[url]}
                isGrasp={false}
                isSelected={selectedSource === url}
                hasState={hasState}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
                onSelect={() => onSelectSource(url)}
              />
            ))}
          </div>
        )}

        {/* Fallback: cloneUrls not split into grasp/other */}
        {!usesGrasp && otherUrls.length === 0 && cloneUrls.length > 0 && (
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Server className="h-3 w-3" />
              Git Servers
            </div>
            {cloneUrls.map((url) => (
              <SourceServerRow
                key={url}
                url={url}
                urlState={urlStates[url]}
                isGrasp={false}
                isSelected={selectedSource === url}
                hasState={hasState}
                gitIsAhead={gitIsAhead}
                stateCreatedAt={stateCreatedAt}
                gitCommitterDate={gitCommitterDate}
                pool={pool}
                onSelect={() => onSelectSource(url)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
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
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);

  const gitSourceUrl =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitServerUrl
      : winnerUrl;
  const gitDomain = gitSourceUrl ? gitServerDomain(gitSourceUrl) : null;

  const isLoading = repoState === undefined || !repoRelayEose;
  const isGitSource = stateBehindGit || isNoState;
  const hasProblems = mismatchCount > 0 || stateBehindGit;

  // A URL (not "default"/"nostr") means the user manually picked a git server
  const isManualGitSource =
    selectedSource !== "default" && selectedSource !== "nostr";
  // "nostr" is an explicit nostr override (only selectable when default ≠ nostr)
  const isExplicitNostr = selectedSource === "nostr";

  const sourceLabel = isManualGitSource
    ? shortServerLabel(selectedSource)
    : isExplicitNostr
      ? "nostr"
      : isGitSource && gitDomain
        ? gitDomain
        : "nostr";
  const sourceIsNostr = !isManualGitSource && (isExplicitNostr || !isGitSource);

  const defaultBranchName = useMemo(() => {
    return refsWithStatus.find((r) => r.isDefault && r.isBranch)?.name;
  }, [refsWithStatus]);

  // Only show DiffSummaryBar when not viewing a manually-selected git server
  const showDiffSummary = hasProblems && !isLoading && !isManualGitSource;

  return (
    <>
      {/* Clickable source row — opens source selector */}
      <Popover open={selectorOpen} onOpenChange={setSelectorOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-2 px-3 py-2 border-b w-full text-left text-[11px] transition-colors",
              hasProblems && !isManualGitSource
                ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                : "border-border/40 bg-muted/20 hover:bg-accent/40",
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

            {/* Right-side status badge */}
            {hasProblems && !isManualGitSource ? (
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
                      maintainer's last Nostr state. Showing the git server's
                      latest data.
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
          className="p-0 overflow-hidden w-[480px] z-50"
          align="start"
          side="bottom"
          sideOffset={0}
          avoidCollisions={true}
        >
          <SourceSelectorPanel
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
          />
        </PopoverContent>
      </Popover>

      {/* Subtle expandable diff summary — only for nostr source */}
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
  graspCloneUrls = [],
  additionalGitServerUrls = [],
  pool,
}: RefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // "default" = let the pool decide (current behaviour — git server when ahead, nostr otherwise)
  // "nostr"   = explicitly force nostr state comparison even when stateBehindGit
  // <url>     = compare against a specific git server's infoRefs
  const [selectedSource, setSelectedSource] = useState<string>("default");
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

  // Compute status for each ref — against selectedSource
  const refsWithStatus: RefWithStatus[] = useMemo(() => {
    if (selectedSource === "default" || selectedSource === "nostr") {
      // "default" uses the pool's normal logic (stateBehindGit respected).
      // "nostr" forces nostr-state comparison by passing stateBehindGit=false,
      // so refs are compared directly against the signed state even when the
      // git server is ahead.
      const behindGit = selectedSource === "nostr" ? false : stateBehindGit;
      return refs.map((ref) => ({
        ...ref,
        ...getRefStatus(
          ref,
          repoState,
          repoRelayEose,
          behindGit,
          urlStates,
          cloneUrls,
        ),
      }));
    }
    // A specific git server URL is selected
    const serverUrlState = urlStates[selectedSource];
    if (!serverUrlState?.infoRefs) {
      // Server not ready — fall back to default behaviour
      return refs.map((ref) => ({
        ...ref,
        ...getRefStatus(
          ref,
          repoState,
          repoRelayEose,
          stateBehindGit,
          urlStates,
          cloneUrls,
        ),
      }));
    }
    return refs.map((ref) => ({
      ...ref,
      ...getRefStatusForServer(ref, serverUrlState, repoState, repoRelayEose),
    }));
  }, [
    refs,
    repoState,
    repoRelayEose,
    stateBehindGit,
    urlStates,
    cloneUrls,
    selectedSource,
  ]);

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

  const showStatusIcon =
    currentStatus !== "loading" &&
    currentStatus !== "no-state" &&
    currentStatus !== "not-on-server";

  // Amber trigger border when there are genuine mismatches or state is behind
  const showAmberTrigger = mismatchCount > 0 || stateBehindGit;

  // Source prefix in trigger button
  const gitSourceUrl =
    poolWarning?.kind === "state-behind-git"
      ? poolWarning.gitServerUrl
      : winnerUrl;
  const gitDomain = gitSourceUrl ? gitServerDomain(gitSourceUrl) : null;

  // A URL (not "default"/"nostr") means the user manually picked a git server
  const isManualGitSource =
    selectedSource !== "default" && selectedSource !== "nostr";
  // Show source prefix when: user manually selected a git server, OR auto-detected git source
  const showGitPrefix =
    isManualGitSource || ((stateBehindGit || isNoState) && gitDomain);
  const sourcePrefix = isManualGitSource
    ? gitServerDomain(selectedSource)
    : gitDomain;

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
        />

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

        <ScrollArea
          type="always"
          style={{
            height:
              "calc(var(--radix-popover-content-available-height) - 140px)",
            maxHeight:
              "calc(var(--radix-popover-content-available-height) - 140px)",
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
                      selectedSource={selectedSource}
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
                      selectedSource={selectedSource}
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
