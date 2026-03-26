/**
 * PatchCommitList — renders a list of commits derived from a NIP-34 patch chain.
 *
 * Each patch in the chain represents one commit. When the patch includes
 * `commit`, `parent-commit`, and `committer` tags, we display the git commit
 * metadata. Otherwise we fall back to the patch subject and event timestamp.
 *
 * Commit links point to `<basePath>/commit/<hash>` when a commit ID is
 * available, matching the same pattern as CommitList for PRs.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, User, GitCommit } from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import type { Patch } from "@/casts/Patch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the committer tag from a patch event.
 * Format: ["committer", "<name>", "<email>", "<timestamp>", "<timezone>"]
 */
function parseCommitterTag(
  patch: Patch,
): { name: string; email: string; timestamp: number } | undefined {
  const tag = patch.event.tags.find(([t]) => t === "committer");
  if (!tag) return undefined;
  const [, name, email, tsStr] = tag;
  if (!name || !tsStr) return undefined;
  const timestamp = parseInt(tsStr, 10);
  if (isNaN(timestamp)) return undefined;
  return { name, email: email ?? "", timestamp };
}

// ---------------------------------------------------------------------------
// PatchCommitList
// ---------------------------------------------------------------------------

export function PatchCommitList({
  patches,
  basePath,
}: {
  /** Ordered patches in the latest revision (oldest first). */
  patches: Patch[];
  /** Prefix for commit links — links become `<basePath>/commit/<hash>`. */
  basePath: string;
}) {
  // Group by date (using committer timestamp or event created_at)
  const grouped = useMemo(() => {
    const groups: { date: string; patches: Patch[] }[] = [];
    let currentDate = "";

    // Render newest first (reverse the oldest-first chain)
    for (const patch of [...patches].reverse()) {
      const committer = parseCommitterTag(patch);
      const ts = committer?.timestamp ?? patch.event.created_at;
      const dateStr = safeFormat(ts, "MMMM d, yyyy") ?? "Unknown date";
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, patches: [] });
      }
      groups[groups.length - 1].patches.push(patch);
    }

    return groups;
  }, [patches]);

  return (
    <div className="space-y-6">
      {grouped.map((group) => (
        <div key={group.date}>
          <div className="flex items-center gap-3 mb-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {group.date}
            </span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
          <Card className="overflow-hidden">
            <div className="divide-y divide-border/40">
              {group.patches.map((patch) => (
                <PatchCommitRow
                  key={patch.id}
                  patch={patch}
                  basePath={basePath}
                />
              ))}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatchCommitRow
// ---------------------------------------------------------------------------

function PatchCommitRow({
  patch,
  basePath,
}: {
  patch: Patch;
  basePath: string;
}) {
  const committer = parseCommitterTag(patch);
  const ts = committer?.timestamp ?? patch.event.created_at;
  const authorName = committer?.name ?? "(unknown)";
  const commitId = patch.commitId;
  const shortHash = commitId?.slice(0, 8);

  const subject = patch.subject;
  const body = patch.body;

  const relativeTime = safeFormatDistanceToNow(ts, { addSuffix: true });

  const titleContent = (
    <span className="text-sm font-medium hover:text-violet-600 dark:hover:text-violet-400 transition-colors line-clamp-2">
      {subject}
    </span>
  );

  return (
    <div className="px-4 py-3 hover:bg-muted/20 transition-colors group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {commitId ? (
            <Link to={`${basePath}/commit/${commitId}`}>{titleContent}</Link>
          ) : (
            titleContent
          )}
          {body && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {body}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span>{authorName}</span>
            <span>&middot;</span>
            <span title={safeFormat(ts, "PPpp") ?? undefined}>
              {relativeTime}
            </span>
          </div>
        </div>
        {commitId ? (
          <Link
            to={`${basePath}/commit/${commitId}`}
            className="shrink-0 font-mono text-xs bg-muted hover:bg-muted/70 px-2 py-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {shortHash}
          </Link>
        ) : (
          <span className="shrink-0 font-mono text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
            <GitCommit className="h-3 w-3 inline" />
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PatchCommitListEmpty (re-exported for convenience)
// ---------------------------------------------------------------------------

export function PatchCommitListEmpty({
  message = "No patches found.",
}: {
  message?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <GitCommit className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
