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

import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { GitCommitHorizontal, GitPullRequest, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserLink } from "@/components/UserAvatar";
import type { PR } from "@/casts/PR";
import type { PRUpdate } from "@/casts/PRUpdate";
import type { PatchRevision } from "@/hooks/usePatchChain";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function CommitRow({
  shortHash,
  subject,
}: {
  shortHash: string;
  subject: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 min-w-0">
      <span className="font-mono text-[11px] text-muted-foreground/70 shrink-0 w-16">
        {shortHash}
      </span>
      <span className="text-sm text-foreground/80 truncate">{subject}</span>
    </div>
  );
}

function SupersededBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/20 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground/60 font-medium shrink-0">
      <RotateCcw className="h-2.5 w-2.5" />
      superseded
    </span>
  );
}

// ---------------------------------------------------------------------------
// PatchSetPushEvent
// ---------------------------------------------------------------------------

/**
 * Renders a patch-set revision as a push timeline node.
 *
 * @param revision   - The PatchRevision (rootPatch + chain)
 * @param superseded - True when a later revision exists
 */
export function PatchSetPushEvent({
  revision,
  superseded,
}: {
  revision: PatchRevision;
  superseded: boolean;
}) {
  const { rootPatch, chain } = revision;

  const timeAgo = formatDistanceToNow(
    new Date(rootPatch.event.created_at * 1000),
    { addSuffix: true },
  );

  const commits = useMemo(
    () =>
      chain.map((p) => ({
        id: p.id,
        shortHash: p.commitId?.slice(0, 7) ?? p.id.slice(0, 7),
        subject: p.subject || "(no subject)",
      })),
    [chain],
  );

  return (
    <div
      className={cn(
        "relative flex gap-3 py-2 pl-1",
        superseded && "opacity-50",
      )}
    >
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
            pushed {commits.length} commit{commits.length !== 1 ? "s" : ""}
            {revision.isRevision && (
              <span className="ml-1 text-xs text-muted-foreground/60">
                (new revision)
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
          {superseded && <SupersededBadge />}
        </div>

        {/* Commit list */}
        <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
          {commits.map((c) => (
            <CommitRow key={c.id} shortHash={c.shortHash} subject={c.subject} />
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
}: {
  pr: PR;
  commits?: Array<{ hash: string; subject: string }>;
  superseded: boolean;
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
      }));
    }
    if (pr.tipCommitId) {
      return [
        {
          key: pr.tipCommitId,
          shortHash: pr.tipCommitId.slice(0, 7),
          subject: "(commits not yet loaded)",
        },
      ];
    }
    return [];
  }, [commits, pr.tipCommitId]);

  return (
    <div
      className={cn(
        "relative flex gap-3 py-2 pl-1",
        superseded && "opacity-50",
      )}
    >
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
          {superseded && <SupersededBadge />}
        </div>

        {/* Commit list */}
        {rows.length > 0 && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
            {rows.map((r) => (
              <CommitRow
                key={r.key}
                shortHash={r.shortHash}
                subject={r.subject}
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
 * @param update     - The PRUpdate cast
 * @param superseded - True when a later PR Update has a different tip
 * @param commits    - Optional resolved commit list (subject + short hash)
 */
export function PRUpdatePushEvent({
  update,
  superseded,
  commits,
}: {
  update: PRUpdate;
  superseded: boolean;
  commits?: Array<{ hash: string; subject: string }>;
}) {
  const timeAgo = formatDistanceToNow(
    new Date(update.event.created_at * 1000),
    { addSuffix: true },
  );

  const rows = useMemo(() => {
    if (commits && commits.length > 0) {
      return commits.map((c) => ({
        key: c.hash,
        shortHash: c.hash.slice(0, 7),
        subject: c.subject,
      }));
    }
    // Fallback: show just the tip commit ID
    if (update.tipCommitId) {
      return [
        {
          key: update.tipCommitId,
          shortHash: update.tipCommitId.slice(0, 7),
          subject: "(commits not yet loaded)",
        },
      ];
    }
    return [];
  }, [commits, update.tipCommitId]);

  return (
    <div
      className={cn(
        "relative flex gap-3 py-2 pl-1",
        superseded && "opacity-50",
      )}
    >
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
            {update.mergeBase && (
              <span className="ml-1 text-xs text-muted-foreground/60">
                · base {update.mergeBase.slice(0, 7)}
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground/50">{timeAgo}</span>
          {superseded && <SupersededBadge />}
        </div>

        {/* Commit list */}
        {rows.length > 0 && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 divide-y divide-border/30">
            {rows.map((r) => (
              <CommitRow
                key={r.key}
                shortHash={r.shortHash}
                subject={r.subject}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
