/**
 * PushEventComponents — timeline nodes for patch-set pushes and PR Updates.
 *
 * Both components render as a compact "push" row in the PR conversation
 * timeline:
 *
 *   [avatar] [name] pushed N commit(s)  ·  [time]   [superseded badge?]
 *   ├─ abc1234  first commit subject
 *   ├─ def5678  second commit subject
 *   └─ ...
 *
 * Superseded styling: when a later push exists, the block is dimmed and
 * labelled "superseded". Commits that are still present in the latest push
 * are NOT marked superseded — only the push event wrapper is.
 */

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  GitCommitHorizontal,
  GitPullRequest,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserLink } from "@/components/UserAvatar";
import { eventIdToNevent } from "@/lib/routeUtils";
import type { PR } from "@/casts/PR";
import type { PRUpdate } from "@/casts/PRUpdate";
import type { PatchRevision } from "@/hooks/usePatchChain";
import type { NostrEvent } from "nostr-tools";
import type { GitGraspPool, PoolState } from "@/lib/git-grasp-pool";
import { useCommitHistory } from "@/hooks/useGitExplorer";
import { usePRMergeBase } from "@/hooks/usePRMergeBase";
import { useActiveAccount } from "applesauce-react/hooks";
import { EventCardActions } from "@/components/EventCardActions";
import { DeleteEvent } from "@/actions/nip34";
import { runner } from "@/services/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function CommitRow({
  shortHash,
  subject,
  href,
  superseded,
}: {
  shortHash: string;
  subject: string;
  href?: string;
  superseded?: boolean;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "font-mono text-[11px] shrink-0",
          superseded
            ? "line-through text-muted-foreground/50"
            : "text-muted-foreground/70",
        )}
      >
        {shortHash}
      </span>
      <span
        className={cn(
          "text-sm truncate",
          superseded ? "line-through text-foreground/40" : "text-foreground/80",
        )}
      >
        {subject}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="flex items-center gap-2 py-0.5 min-w-0 rounded px-1 -mx-1 transition-colors hover:bg-muted/40"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5 min-w-0 rounded px-1 -mx-1">
      {inner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Minimal no-op PoolState used as a fallback when no git pool is available. */
const EMPTY_POOL_STATE: PoolState = {
  urls: {},
  winnerUrl: null,
  health: "idle",
  loading: false,
  pulling: false,
  latestCommit: null,
  readmeContent: null,
  readmeFilename: null,
  defaultBranch: null,
  warning: null,
  error: null,
  lastCheckedAt: null,
  crossRefDiscrepancies: [],
  retryAt: null,
};

function OutdatedBadge({ commitsHref }: { commitsHref?: string }) {
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600/80 dark:text-amber-400/80 font-medium shrink-0">
      <RotateCcw className="h-2.5 w-2.5" />
      outdated
    </span>
  );
  if (commitsHref) {
    return (
      <Link to={commitsHref} className="shrink-0">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ---------------------------------------------------------------------------
// PatchSetPushEvent
// ---------------------------------------------------------------------------

/**
 * Renders a patch-set revision as a push timeline node.
 *
 * @param revision       - The PatchRevision (rootPatch + chain)
 * @param superseded     - True when a later revision exists
 * @param revisionNumber - 1-based revision index (1 = original, 2 = first force push, …)
 */
export function PatchSetPushEvent({
  revision,
  superseded,
  basePath,
  revisionNumber,
  relayHints,
}: {
  revision: PatchRevision;
  superseded: boolean;
  basePath?: string;
  revisionNumber?: number;
  /** Relay hints to embed in nevent1 commit link segments. */
  relayHints?: string[];
}) {
  const { rootPatch, chain } = revision;

  const timeAgo = formatDistanceToNow(
    new Date(rootPatch.event.created_at * 1000),
    { addSuffix: true },
  );

  const commits = useMemo(
    () =>
      chain
        .filter((p) => !p.isCoverLetter)
        .map((p) => ({
          id: p.id,
          commitId: p.commitId,
          // nevent1 of the patch event ID is the canonical URL segment.
          // The router decodes it back to the event ID for patchMatch.
          linkSegment: eventIdToNevent(p.event.id, relayHints),
          shortHash: p.commitId?.slice(0, 7) ?? p.id.slice(0, 7),
          subject: p.subject || "(no subject)",
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chain, relayHints?.join(",")],
  );

  const isForcePush = revision.isRevision;

  return (
    <div className="relative flex gap-3 py-2 pl-1">
      {/* Icon column */}
      <div className="flex items-start pt-0.5 shrink-0">
        <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <UserLink
            pubkey={rootPatch.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium text-foreground"
          />
          <span className="text-sm text-muted-foreground">
            {isForcePush ? "force pushed" : "opened this patch"}
            {revisionNumber !== undefined && revisionNumber > 1 && (
              <span className="ml-1 text-xs text-muted-foreground/60">
                (revision {revisionNumber})
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
          {superseded && (
            <OutdatedBadge
              commitsHref={basePath ? `${basePath}/commits` : undefined}
            />
          )}
        </div>

        {/* Commit list */}
        <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
          {commits.map((c) => (
            <CommitRow
              key={c.id}
              shortHash={c.shortHash}
              subject={c.subject}
              superseded={superseded}
              href={
                basePath ? `${basePath}/commit/${c.linkSegment}` : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROpenPushEvent
// ---------------------------------------------------------------------------

/**
 * Renders the initial PR event (kind:1618) as a push timeline node — the
 * "opened this pull request" entry, analogous to GitHub's first push row.
 *
 * Shows the tip commit (if present) as a single commit row. If git commit
 * history is available (passed in via `commits`), we show one row per commit.
 *
 * @param pr      - The PR cast (kind:1618)
 * @param commits - Optional resolved commit list (subject + short hash)
 * @param superseded - True when a later PR Update has replaced this tip
 */
export function PROpenPushEvent({
  pr,
  commits,
  superseded,
  basePath,
}: {
  pr: PR;
  commits?: Array<{ hash: string; subject: string }>;
  superseded: boolean;
  basePath?: string;
}) {
  const timeAgo = formatDistanceToNow(new Date(pr.event.created_at * 1000), {
    addSuffix: true,
  });

  const rows = useMemo(() => {
    if (commits && commits.length > 0) {
      return commits.map((c) => ({
        key: c.hash,
        shortHash: c.hash.slice(0, 7),
        subject: c.subject,
        href: basePath ? `${basePath}/commit/${c.hash}` : undefined,
      }));
    }
    if (pr.tipCommitId) {
      return [
        {
          key: pr.tipCommitId,
          shortHash: pr.tipCommitId.slice(0, 7),
          subject: "(commits not yet loaded)",
          href: undefined,
        },
      ];
    }
    return [];
  }, [commits, pr.tipCommitId, basePath]);

  return (
    <div className="relative flex gap-3 py-2 pl-1">
      {/* Icon column */}
      <div className="flex items-start pt-0.5 shrink-0">
        <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40">
          <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <UserLink
            pubkey={pr.pubkey}
            avatarSize="sm"
            nameClassName="text-sm font-medium text-foreground"
          />
          <span className="text-sm text-muted-foreground">
            opened this pull request
            {pr.mergeBase && (
              <span className="ml-1 text-xs text-muted-foreground/60">
                · base {pr.mergeBase.slice(0, 7)}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
          {superseded && (
            <OutdatedBadge
              commitsHref={basePath ? `${basePath}/commits` : undefined}
            />
          )}
        </div>

        {/* Commit list */}
        {rows.length > 0 && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
            {rows.map((r) => (
              <CommitRow
                key={r.key}
                shortHash={r.shortHash}
                subject={r.subject}
                superseded={superseded}
                href={r.href}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRUpdatePushEvent
// ---------------------------------------------------------------------------

/**
 * Renders a kind:1619 PR Update as a push timeline node.
 *
 * For PR Updates we don't have individual patch subjects — we only have the
 * new tip commit ID. We show the tip commit as a single row. If git commit
 * history is available (passed in via `commits`), we show one row per commit.
 *
 * Superseded logic: a PR Update is superseded only if a *later* PR Update
 * changes the tip to a commit that is NOT a descendant of this one. Since we
 * can't easily determine ancestry without a git walk, we use a simpler rule:
 * if the tip commit ID changed in a later update, this one is superseded.
 * The caller is responsible for computing `superseded`.
 *
 * @param update         - The PRUpdate cast
 * @param superseded     - True when a later PR Update has a different tip
 * @param commits        - Optional resolved commit list (subject + short hash)
 * @param revisionNumber - 1-based revision index (2 = first force push, …)
 */
/**
 * Minimal interface for a PR Update — satisfied by both the PRUpdate cast
 * and a plain object constructed from a PRRevision.
 */
interface PRUpdateLike {
  event: NostrEvent;
  pubkey: string;
  tipCommitId: string | undefined;
  mergeBase: string | undefined;
}

export function PRUpdatePushEvent({
  update,
  superseded,
  commits,
  basePath,
  revisionNumber,
  gitPool,
  gitPoolState,
  fallbackUrls,
  mergeBase: mergeBaseProp,
  repoCoords,
}: {
  update: PRUpdate | PRUpdateLike;
  superseded: boolean;
  commits?: Array<{ hash: string; subject: string }>;
  basePath?: string;
  revisionNumber?: number;
  /** Git pool for loading commit history (optional — enables live commit loading). */
  gitPool?: GitGraspPool | null;
  /** Pool state (required when gitPool is provided). */
  gitPoolState?: PoolState;
  /** Extra clone URLs to try when fetching commits. */
  fallbackUrls?: string[];
  /** Pre-resolved merge base for this revision (avoids redundant git walk). */
  mergeBase?: string;
  /** Repo coordinate strings — enables the delete button for the event author. */
  repoCoords?: string[];
}) {
  const timeAgo = formatDistanceToNow(
    new Date(update.event.created_at * 1000),
    { addSuffix: true },
  );

  const activeAccount = useActiveAccount();
  const isOwn = !!activeAccount && activeAccount.pubkey === update.event.pubkey;

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = useCallback(async () => {
    if (deleting || !repoCoords) return;
    setDeleting(true);
    try {
      await runner.run(
        DeleteEvent,
        [update.event],
        repoCoords,
        deleteReason.trim() || undefined,
      );
    } catch (err) {
      console.error("[PRUpdatePushEvent] failed to delete event:", err);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeleteReason("");
    }
  }, [deleting, update.event, repoCoords, deleteReason]);

  const deleteReasonId = `delete-pr-update-${update.event.id.slice(0, 8)}-reason`;

  // Resolve merge base for this revision's tip so we can trim the commit list.
  const { mergeBase: resolvedMergeBase } = usePRMergeBase(
    gitPool ?? null,
    gitPoolState ?? EMPTY_POOL_STATE,
    gitPool ? update.tipCommitId : undefined,
    mergeBaseProp ?? update.mergeBase,
    fallbackUrls,
  );

  const effectiveMergeBase =
    mergeBaseProp ?? update.mergeBase ?? resolvedMergeBase;

  // Load commit history for this revision's tip commit.
  const commitHistory = useCommitHistory(
    gitPool ?? null,
    gitPoolState ?? EMPTY_POOL_STATE,
    gitPool ? update.tipCommitId : undefined,
    100,
    fallbackUrls,
    effectiveMergeBase,
  );

  // Trim commits up to (but not including) the merge base.
  const loadedCommits = useMemo(() => {
    if (!commitHistory.commits.length) return [];
    const trimmed = (() => {
      if (!effectiveMergeBase) return commitHistory.commits;
      const idx = commitHistory.commits.findIndex(
        (c) => c.hash === effectiveMergeBase,
      );
      return idx === -1
        ? commitHistory.commits
        : commitHistory.commits.slice(0, idx);
    })();
    return [...trimmed].reverse();
  }, [commitHistory.commits, effectiveMergeBase]);

  const rows = useMemo(() => {
    // Prefer explicitly passed commits, then git-loaded commits.
    const source =
      commits && commits.length > 0
        ? commits
        : loadedCommits.length > 0
          ? loadedCommits.map((c) => ({
              hash: c.hash,
              subject: c.message.split("\n")[0],
            }))
          : null;

    if (source) {
      return source.map((c) => ({
        key: c.hash,
        shortHash: c.hash.slice(0, 7),
        subject: c.subject,
        href: basePath ? `${basePath}/commit/${c.hash}` : undefined,
      }));
    }
    // Fallback: show just the tip commit ID while loading
    if (update.tipCommitId) {
      return [
        {
          key: update.tipCommitId,
          shortHash: update.tipCommitId.slice(0, 7),
          subject: commitHistory.loading
            ? "Loading commits…"
            : "(commits not available)",
          href: basePath
            ? `${basePath}/commit/${update.tipCommitId}`
            : undefined,
        },
      ];
    }
    return [];
  }, [
    commits,
    loadedCommits,
    commitHistory.loading,
    update.tipCommitId,
    basePath,
  ]);

  return (
    <>
      <div className="relative flex gap-3 py-2 pl-1">
        {/* Icon column */}
        <div className="flex items-start pt-0.5 shrink-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-muted/40">
            <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <UserLink
              pubkey={update.pubkey}
              avatarSize="sm"
              nameClassName="text-sm font-medium text-foreground"
            />
            <span className="text-sm text-muted-foreground">
              force pushed
              {revisionNumber !== undefined && revisionNumber > 1 && (
                <span className="ml-1 text-xs text-muted-foreground/60">
                  (revision {revisionNumber})
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
            {superseded && (
              <OutdatedBadge
                commitsHref={basePath ? `${basePath}/commits` : undefined}
              />
            )}
            {/* Delete + share actions */}
            <div className="ml-auto flex items-center gap-0.5 shrink-0">
              {isOwn && repoCoords && (
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="flex items-center text-xs text-muted-foreground/50 hover:text-destructive transition-colors px-1.5 py-0.5 rounded"
                  aria-label="Delete PR update"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <EventCardActions event={update.event} />
            </div>
          </div>

          {/* Commit list */}
          {rows.length > 0 && (
            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
              {rows.map((r) => (
                <CommitRow
                  key={r.key}
                  shortHash={r.shortHash}
                  subject={r.subject}
                  superseded={superseded}
                  href={r.href}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => !v && setDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this PR update?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send a deletion request (NIP-09). Not all relays honour
              deletion requests — the event may remain visible on some clients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor={deleteReasonId} className="text-sm">
              Reason{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id={deleteReasonId}
              placeholder="Why are you deleting this PR update?"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteOpen(false);
                setDeleteReason("");
              }}
              disabled={deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Sending…" : "Send deletion request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
