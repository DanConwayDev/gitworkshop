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
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { GitCommitHorizontal, GitPullRequest, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserLink } from "@/components/UserAvatar";
import type { PR } from "@/casts/PR";
import type { PRUpdate } from "@/casts/PRUpdate";
import type { PatchRevision } from "@/hooks/usePatchChain";
import type { NostrEvent } from "nostr-tools";

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
}: {
  revision: PatchRevision;
  superseded: boolean;
  basePath?: string;
  revisionNumber?: number;
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
          shortHash: p.commitId?.slice(0, 7) ?? p.id.slice(0, 7),
          subject: p.subject || "(no subject)",
        })),
    [chain],
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
                basePath && c.commitId
                  ? `${basePath}/commit/${c.commitId}`
                  : undefined
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
}: {
  update: PRUpdate | PRUpdateLike;
  superseded: boolean;
  commits?: Array<{ hash: string; subject: string }>;
  basePath?: string;
  revisionNumber?: number;
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
        href: basePath ? `${basePath}/commit/${c.hash}` : undefined,
      }));
    }
    // Fallback: show just the tip commit ID
    if (update.tipCommitId) {
      return [
        {
          key: update.tipCommitId,
          shortHash: update.tipCommitId.slice(0, 7),
          subject: "(commits not yet loaded)",
          href: basePath
            ? `${basePath}/commit/${update.tipCommitId}`
            : undefined,
        },
      ];
    }
    return [];
  }, [commits, update.tipCommitId, basePath]);

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
