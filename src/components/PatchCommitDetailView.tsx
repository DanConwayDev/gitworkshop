/**
 * PatchCommitDetailView — commit detail view for patch-sourced commits.
 *
 * Renders the same visual structure as CommitDetailView but uses data
 * extracted from NIP-34 patch events instead of fetching from a git server.
 * The diff comes from the patch's embedded format-patch content, not from
 * tree-based diffing.
 *
 * Used by PRCommitPage when the commit doesn't exist on the git server
 * (which is the normal case for patch-type PRs).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GitCommit,
  User,
  Clock,
  ArrowLeft,
  Copy,
  Check,
  Hash,
} from "lucide-react";
import { safeFormatDistanceToNow, safeFormat } from "@/lib/utils";
import { DiffView } from "@/components/DiffView";
import type { Commit } from "@fiatjaf/git-natural-api";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PatchCommitDetailViewProps {
  /** Synthetic Commit object built from patch metadata. */
  commit: Commit;
  /** Raw unified diff string from the patch event's content. */
  patchDiff: string;
  /** Prefix for parent commit links: `${basePath}/commit/${parentHash}` */
  basePath: string;
  /** href for the back navigation link */
  backTo: string;
  /** Label for the back navigation link */
  backLabel?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PatchCommitDetailView({
  commit,
  patchDiff,
  basePath,
  backTo,
  backLabel = "All commits",
}: PatchCommitDetailViewProps) {
  const [copied, setCopied] = useState(false);

  const authorTs = commit.author.timestamp * 1000;
  const committerTs =
    (commit.committer?.timestamp ?? commit.author.timestamp) * 1000;
  const subject = commit.message.split("\n")[0];
  const body = commit.message.split("\n").slice(2).join("\n").trim();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Back link */}
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 shrink-0">
              <GitCommit className="h-5 w-5 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold leading-snug">{subject}</h1>
              {body && (
                <pre className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
                  {body}
                </pre>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 border-t border-border/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
            {/* Author */}
            <div className="flex items-start gap-2">
              <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Author</p>
                <p className="text-sm font-medium">{commit.author.name}</p>
                <p className="text-xs text-muted-foreground">
                  {commit.author.email}
                </p>
                <p
                  className="text-xs text-muted-foreground"
                  title={safeFormat(authorTs / 1000, "PPpp") ?? undefined}
                >
                  {safeFormatDistanceToNow(commit.author.timestamp, {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>

            {/* Committer (only when different from author) */}
            {commit.committer &&
              commit.committer.name !== commit.author.name && (
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Committed by
                    </p>
                    <p className="text-sm font-medium">
                      {commit.committer.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {commit.committer.email}
                    </p>
                    <p
                      className="text-xs text-muted-foreground"
                      title={
                        safeFormat(committerTs / 1000, "PPpp") ?? undefined
                      }
                    >
                      {safeFormatDistanceToNow(
                        commit.committer?.timestamp ?? commit.author.timestamp,
                        { addSuffix: true },
                      )}
                    </p>
                  </div>
                </div>
              )}
          </div>

          {/* Hash + parent links */}
          <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <code className="text-xs font-mono text-muted-foreground break-all">
                {commit.hash}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
            </div>

            {commit.parents && commit.parents.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Parents:</span>
                {commit.parents.map((p) => (
                  <Link
                    key={p}
                    to={`${basePath}/commit/${p}`}
                    className="text-xs font-mono text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {p.slice(0, 8)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Diff from patch content */}
      {patchDiff ? (
        <DiffView diff={patchDiff} />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-sm text-muted-foreground">
          No diff content available for this patch.
        </div>
      )}
    </div>
  );
}
