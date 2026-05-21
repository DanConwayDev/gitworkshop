/**
 * Shared ref-row primitive used by both the popover ref selector and the
 * full-page `/branches` and `/tags` views.
 *
 * Two densities:
 *
 *  - "compact"  : the original popover row (single-line button with a check
 *                 mark, a per-source lazy commit timestamp and a status
 *                 icon). Extracted unchanged from `RefSelector.tsx`.
 *
 *  - "expanded" : a two-line list-item layout used on the full-page views:
 *
 *      [icon]  <name>  [default badge]  [status icon]
 *              <hash>  ·  <first-line commit message>  ·  <X ago>
 *                                          [ahead] [behind] | [annotated]
 *
 *    When the caller provides a `divergence` prop (only populated for
 *    non-default branches on the branches page) the row renders the
 *    ahead/behind badges and reuses `divergence.latestCommit` for the
 *    message + timestamp. Otherwise the row falls back to the same lazy
 *    `pool.getSingleCommit` fetch the compact density uses.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  Tag,
  Check,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  Minus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn, safeFormatDistanceToNow } from "@/lib/utils";
import type { GitGraspPool } from "@/lib/git-grasp-pool";
import type { UrlState } from "@/lib/git-grasp-pool/types";
import type { Commit } from "@/lib/vendored/git-natural-api";
import type { RefStatus, RefWithStatus } from "@/lib/refStatus";
import { gitServerDomain } from "@/components/SourceSelector";

// ---------------------------------------------------------------------------
// Status icon + tooltip text — shared between densities
// ---------------------------------------------------------------------------

export function StatusIcon({
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

export function StatusTooltipText({
  refWithStatus,
  effectiveSource,
}: {
  refWithStatus: RefWithStatus;
  /** "nostr" or a concrete clone URL — never "default". */
  effectiveSource: string;
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the commit hash for a ref under the currently-selected source.
 * When a concrete git-server URL is selected we use that server's commit
 * (from `urlStates[…].refCommits`) so the timestamp/message reflect what
 * that server has, rather than the pool winner's commit.
 */
function useSourceHash(
  refWithStatus: RefWithStatus,
  effectiveSource: string,
  urlStates?: Record<string, UrlState>,
): string {
  const fullRefName = `${refWithStatus.isBranch ? "refs/heads/" : "refs/tags/"}${refWithStatus.name}`;
  return useMemo(() => {
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
}

/**
 * Lazily fetch the full commit for a hash via the pool. Aborts on hash change
 * and on unmount. Returns null while loading or if the fetch fails.
 *
 * Skipped entirely when `skip` is true — used by the expanded density to
 * avoid an extra request when the caller already supplies `divergence.latestCommit`.
 */
function useLazyCommit(
  pool: GitGraspPool | null | undefined,
  hash: string,
  skip = false,
): Commit | null {
  const [commit, setCommit] = useState<Commit | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!pool || skip) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCommit(null);

    pool
      .getSingleCommit(hash, ac.signal)
      .then((c) => {
        if (ac.signal.aborted || !c) return;
        setCommit(c);
      })
      .catch(() => {});

    return () => {
      ac.abort();
    };
  }, [hash, pool, skip]);

  return commit;
}

function commitTimestamp(c: Commit | null | undefined): number | null {
  if (!c) return null;
  return c.committer?.timestamp ?? c.author.timestamp;
}

function firstLine(message: string | undefined): string {
  if (!message) return "";
  const nl = message.indexOf("\n");
  return nl === -1 ? message : message.slice(0, nl);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BaseRefRowProps {
  refWithStatus: RefWithStatus;
  /** Resolved source — "nostr" or a concrete clone URL, never "default". */
  effectiveSource: string;
  pool?: GitGraspPool | null;
  urlStates?: Record<string, UrlState>;
}

export interface CompactRefRowProps extends BaseRefRowProps {
  density: "compact";
  isSelected: boolean;
  onSelect: () => void;
}

export interface BranchDivergence {
  ahead: number | null;
  behind: number | null;
  latestCommit: Commit | null;
}

export interface ExpandedRefRowProps extends BaseRefRowProps {
  density: "expanded";
  /**
   * Branch divergence vs the default branch. Only populated for non-default
   * branches on the branches page. When present, the row renders ahead/behind
   * badges and uses `latestCommit` for the message + timestamp (no extra
   * `getSingleCommit` fetch).
   */
  divergence?: BranchDivergence;
  /** Set by the caller for tags whose `rawTagOid !== undefined`. */
  annotated?: boolean;
  /**
   * Optional click handler for the whole row. When omitted the row renders
   * as a non-interactive `div`.
   */
  onSelect?: () => void;
}

export type RefRowProps = CompactRefRowProps | ExpandedRefRowProps;

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export function RefRow(props: RefRowProps) {
  if (props.density === "compact") return <CompactRefRow {...props} />;
  return <ExpandedRefRow {...props} />;
}

// ---------------------------------------------------------------------------
// Compact density (popover) — unchanged behaviour
// ---------------------------------------------------------------------------

function CompactRefRow({
  refWithStatus,
  isSelected,
  onSelect,
  effectiveSource,
  pool,
  urlStates,
}: CompactRefRowProps) {
  const sourceHash = useSourceHash(refWithStatus, effectiveSource, urlStates);
  const commit = useLazyCommit(pool, sourceHash);
  const commitTs = commitTimestamp(commit);

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
// Expanded density (full-page /branches and /tags)
// ---------------------------------------------------------------------------

function ExpandedRefRow({
  refWithStatus,
  effectiveSource,
  pool,
  urlStates,
  divergence,
  annotated,
  onSelect,
}: ExpandedRefRowProps) {
  const sourceHash = useSourceHash(refWithStatus, effectiveSource, urlStates);

  // Skip the lazy fetch when the caller already supplies a commit via
  // `divergence.latestCommit` — that's the common case on the branches page
  // where `useBranchDivergence` has already loaded each branch's HEAD.
  const lazyCommit = useLazyCommit(
    pool,
    sourceHash,
    !!divergence?.latestCommit,
  );
  const commit = divergence?.latestCommit ?? lazyCommit;
  const commitTs = commitTimestamp(commit);
  const commitMessage = firstLine(commit?.message);

  const sourceIsGitServer = effectiveSource !== "nostr";
  const isAbsent =
    refWithStatus.status === "not-on-server" ||
    (refWithStatus.status === "git-server-only" && !sourceIsGitServer);
  const showTooltip =
    refWithStatus.status !== "no-state" && refWithStatus.status !== "loading";

  const Icon = refWithStatus.isBranch ? GitBranch : Tag;

  const interactive = !!onSelect;
  const Wrapper: "button" | "div" = interactive ? "button" : "div";

  const wrapperProps = interactive
    ? {
        type: "button" as const,
        onClick: onSelect,
      }
    : {};

  const ahead = divergence?.ahead ?? null;
  const behind = divergence?.behind ?? null;
  const hasDivergenceBadges =
    ahead !== null || behind !== null || annotated === true;

  const statusIconWithTooltip = showTooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center"
          // Stop click on the icon from triggering the row's onSelect
          onClick={(e) => e.stopPropagation()}
        >
          <StatusIcon status={refWithStatus.status} className="shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        className="max-w-[280px] text-xs"
        sideOffset={8}
      >
        <StatusTooltipText
          refWithStatus={refWithStatus}
          effectiveSource={effectiveSource}
        />
      </TooltipContent>
    </Tooltip>
  ) : (
    <StatusIcon status={refWithStatus.status} className="shrink-0" />
  );

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "flex items-start gap-3 w-full px-4 py-3 text-left",
        interactive &&
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors",
        refWithStatus.status === "mismatch" &&
          interactive &&
          "hover:bg-amber-500/10 dark:hover:bg-amber-500/10",
        refWithStatus.status === "old-state" &&
          interactive &&
          "hover:bg-sky-500/10 dark:hover:bg-sky-500/10",
        isAbsent && "opacity-60",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />

      <div className="flex-1 min-w-0 space-y-1">
        {/* Line 1: name + default badge + status icon */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "font-medium text-sm truncate font-mono",
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
          {refWithStatus.isDefault && (
            <Badge
              variant="secondary"
              className="text-[10px] h-4 px-1.5 shrink-0 font-normal"
            >
              default
            </Badge>
          )}
          {statusIconWithTooltip}
        </div>

        {/* Line 2: hash · message · time */}
        <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground min-w-0">
          <code className="font-mono text-[11px] bg-muted/50 px-1 rounded shrink-0">
            {sourceHash.slice(0, 8)}
          </code>
          {commitMessage && (
            <>
              <span className="shrink-0 text-muted-foreground/40">·</span>
              <span className="truncate min-w-0" title={commitMessage}>
                {commitMessage}
              </span>
            </>
          )}
          {commitTs !== null && (
            <>
              <span className="shrink-0 text-muted-foreground/40">·</span>
              <span className="shrink-0 text-muted-foreground/60">
                {safeFormatDistanceToNow(commitTs, { addSuffix: true })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Trailing: ahead/behind (branches) or annotated badge (tags) */}
      {hasDivergenceBadges && (
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {ahead !== null && ahead > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 font-normal gap-0.5"
              title={`${ahead} commit${ahead === 1 ? "" : "s"} ahead of default`}
            >
              <ArrowUp className="h-3 w-3" />
              {ahead}
            </Badge>
          )}
          {behind !== null && behind > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 font-normal gap-0.5"
              title={`${behind} commit${behind === 1 ? "" : "s"} behind default`}
            >
              <ArrowDown className="h-3 w-3" />
              {behind}
            </Badge>
          )}
          {annotated === true && (
            <Badge
              variant="secondary"
              className="text-[10px] h-5 px-1.5 font-normal"
              title="Annotated tag"
            >
              annotated
            </Badge>
          )}
        </div>
      )}
    </Wrapper>
  );
}
