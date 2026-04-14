/**
 * ActivityFeed — renders a user's recent git activity.
 *
 * Displays issues, patches, PRs, and NIP-22 git comments authored by a user,
 * sorted newest-first. Each item shows:
 *   - An icon indicating the activity type
 *   - A title / subject line
 *   - A RepoBadge linking to the relevant repository
 *   - A relative timestamp
 *
 * The component is intentionally stateless — it receives the raw events from
 * the useUserActivity hook and renders them.
 */

import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RepoBadge } from "@/components/RepoBadge";
import { eventIdToNevent } from "@/lib/routeUtils";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  extractPatchSubject,
} from "@/lib/nip34";
import type { NostrEvent } from "nostr-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the subject/title from an activity event. */
function getActivityTitle(event: NostrEvent): string {
  // Issues and PRs use a "subject" tag
  const subject = event.tags.find(([t]) => t === "subject")?.[1];
  if (subject) return subject;

  // Patches use description tag or content
  if (event.kind === PATCH_KIND) {
    return extractPatchSubject(event);
  }

  // Comments: use first line of content
  if (event.kind === COMMENT_KIND) {
    const firstLine = event.content.split("\n")[0].trim();
    return firstLine.length > 120
      ? firstLine.slice(0, 120) + "…"
      : firstLine || "(empty comment)";
  }

  return "(untitled)";
}

/**
 * Extract the repo coordinate from an activity event.
 * Issues/patches/PRs use an `a` tag pointing to the repo.
 * Comments use an `A` tag (uppercase, NIP-22 root) or `a` tag.
 */
function getRepoCoord(event: NostrEvent): string | undefined {
  // NIP-22 comments: uppercase A = root event coord (may be a repo or item)
  // We want the repo coord, which is in the `a` tag (lowercase)
  const aTag = event.tags.find(([t]) => t === "a")?.[1];
  if (aTag?.startsWith("30617:")) return aTag;

  // For comments, the root might be an issue/PR/patch — extract repo from
  // the `A` tag (uppercase) if it's a repo coord
  const upperA = event.tags.find(([t]) => t === "A")?.[1];
  if (upperA?.startsWith("30617:")) return upperA;

  return undefined;
}

/** Build the navigation path for an activity event. */
function getActivityPath(event: NostrEvent): string {
  const nevent = eventIdToNevent(event.id);

  // For issues, patches, PRs: navigate to the item detail page
  // The app uses /:npub/:repoId/issues/:nevent etc. but the simplest
  // universal path is the nevent NIP-19 route which NIP19Page handles.
  return `/${nevent}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ActivityIconProps {
  kind: number;
}

function ActivityIcon({ kind }: ActivityIconProps) {
  switch (kind) {
    case ISSUE_KIND:
      return (
        <div className="p-1.5 rounded-md bg-blue-500/10 shrink-0">
          <CircleDot className="h-3.5 w-3.5 text-blue-500" />
        </div>
      );
    case PATCH_KIND:
      return (
        <div className="p-1.5 rounded-md bg-amber-500/10 shrink-0">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-amber-500" />
        </div>
      );
    case PR_KIND:
      return (
        <div className="p-1.5 rounded-md bg-purple-500/10 shrink-0">
          <GitPullRequest className="h-3.5 w-3.5 text-purple-500" />
        </div>
      );
    case COMMENT_KIND:
      return (
        <div className="p-1.5 rounded-md bg-emerald-500/10 shrink-0">
          <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
        </div>
      );
    default:
      return (
        <div className="p-1.5 rounded-md bg-muted shrink-0">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      );
  }
}

function activityVerb(kind: number): string {
  switch (kind) {
    case ISSUE_KIND:
      return "opened issue";
    case PATCH_KIND:
      return "submitted patch";
    case PR_KIND:
      return "opened PR";
    case COMMENT_KIND:
      return "commented";
    default:
      return "activity";
  }
}

interface ActivityItemProps {
  event: NostrEvent;
}

function ActivityItem({ event }: ActivityItemProps) {
  const title = getActivityTitle(event);
  const repoCoord = getRepoCoord(event);
  const path = getActivityPath(event);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <Link to={path} className="group block">
      <Card className="transition-all duration-200 hover:shadow-md hover:shadow-pink-500/5 hover:border-pink-500/20 group-hover:-translate-y-0.5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <ActivityIcon kind={event.kind} />

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  {title}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {activityVerb(event.kind)}
                </span>

                {repoCoord && (
                  <span onClick={(e) => e.preventDefault()}>
                    <RepoBadge coord={repoCoord} className="text-[10px]" />
                  </span>
                )}

                <span className="text-xs text-muted-foreground/60 ml-auto shrink-0">
                  {timeAgo}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ActivitySkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-7 w-7 rounded-md shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-3 w-14 ml-auto" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  /** Raw activity events, sorted newest-first. undefined = loading. */
  events: NostrEvent[] | undefined;
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  if (!events) {
    return (
      <div className="grid gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <ActivitySkeleton key={i} />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No recent git activity found.</p>
          <p className="text-muted-foreground/60 text-sm mt-1">
            Issues, patches, PRs, and comments will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => (
        <ActivityItem key={event.id} event={event} />
      ))}
    </div>
  );
}
