/**
 * PRHeader — shared header for PR/patch detail views.
 *
 * Renders the PR title, status badge, author, labels, and an optional tab bar.
 * Used by both PRPage (with tabs) and PRCommitPage (without tabs).
 */

import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { EditableSubject } from "@/components/EditSubjectInline";
import { UserLink } from "@/components/UserAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { LabelBadge } from "@/components/LabelBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, GitPullRequest, GitCommitHorizontal } from "lucide-react";
import type { ResolvedPR } from "@/lib/nip34";

export interface PRHeaderProps {
  pr: ResolvedPR | undefined;
  canEdit: boolean;
  /** Optional tab bar rendered to the right of the title block. */
  tabs?: React.ReactNode;
}

export function PRHeader({ pr, canEdit, tabs }: PRHeaderProps) {
  const TypeIcon = useMemo(
    () => (pr?.itemType === "patch" ? GitCommitHorizontal : GitPullRequest),
    [pr?.itemType],
  );

  return (
    <div className="border-b border-border/40">
      <div className="container max-w-screen-xl px-4 md:px-8 pt-6 pb-0">
        {pr ? (
          <div className="flex flex-wrap items-end justify-between gap-x-4">
            {/* Left: title + meta */}
            <div className="min-w-0 pb-4">
              <div className="flex items-start gap-3 mb-3">
                <StatusBadge
                  status={pr.status}
                  variant="pr"
                  className="mt-1 shrink-0"
                />
                <EditableSubject
                  issueId={pr.rootEvent.id}
                  currentSubject={pr.currentSubject || pr.originalSubject}
                  canEdit={canEdit}
                  repoCoords={pr.repoCoords}
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground ml-[calc(theme(spacing.3)+4.5rem-3.5rem)]">
                <div className="flex items-center gap-1">
                  <TypeIcon className="h-3.5 w-3.5" />
                  <span className="text-xs capitalize">{pr.itemType}</span>
                </div>
                <UserLink
                  pubkey={pr.pubkey}
                  avatarSize="sm"
                  nameClassName="text-sm"
                />
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {formatDistanceToNow(new Date(pr.createdAt * 1000), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {pr.labels.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {pr.labels.map((label) => (
                      <LabelBadge key={label} label={label} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: optional tabs */}
            {tabs && <div className="shrink-0">{tabs}</div>}
          </div>
        ) : (
          <div className="space-y-3 pb-4">
            <div className="flex gap-3">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-7 w-96" />
            </div>
            <div className="flex gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
