/**
 * ActivityFeed — renders a user's recent git activity.
 *
 * Layout:
 *   - Grouped by time period (Today / This week / Last week / Last month /
 *     2 months ago), then by repository within each period.
 *   - Each item shows: icon · verb · title · "in {RepoBadge}" · timestamp
 *   - Comments show "commented in {repo}" with the comment snippet as the
 *     title; parent title is shown when already in the EventStore.
 *   - Status events show "closed issue" / "resolved PR" etc.
 *   - Cover notes show "posted cover note on {item} in {repo}".
 *
 * The component is stateless — it receives raw events from useUserActivity
 * and renders them.
 */

import { Link } from "react-router-dom";
import {
  startOfDay,
  startOfWeek,
  subWeeks,
  startOfMonth,
  subMonths,
  formatDistanceToNow,
} from "date-fns";
import {
  CircleDot,
  GitPullRequest,
  GitCommitHorizontal,
  MessageCircle,
  Activity,
  XCircle,
  FileText,
  GitMerge,
  StickyNote,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RepoBadge } from "@/components/RepoBadge";
import { eventIdToNevent } from "@/lib/routeUtils";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  COMMENT_KIND,
  COVER_NOTE_KIND,
  STATUS_OPEN,
  STATUS_RESOLVED,
  STATUS_CLOSED,
  STATUS_DRAFT,
  extractPatchSubject,
  extractSubject,
} from "@/lib/nip34";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import { map } from "rxjs/operators";

// ---------------------------------------------------------------------------
// Time-bucket helpers
// ---------------------------------------------------------------------------

type TimeBucket = "today" | "this-week" | "last-week" | "last-month" | "older";

const BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Today",
  "this-week": "This week",
  "last-week": "Last week",
  "last-month": "Last month",
  older: "2 months ago",
};

function getTimeBucket(ts: number): TimeBucket {
  const now = new Date();
  const date = new Date(ts * 1000);

  if (date >= startOfDay(now)) return "today";

  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  if (date >= thisWeekStart) return "this-week";

  const lastWeekStart = subWeeks(thisWeekStart, 1);
  if (date >= lastWeekStart) return "last-week";

  const thisMonthStart = startOfMonth(now);
  if (date >= thisMonthStart) return "last-month";

  const twoMonthsAgo = subMonths(startOfMonth(now), 1);
  if (date >= twoMonthsAgo) return "last-month";

  return "older";
}

// ---------------------------------------------------------------------------
// Event metadata helpers
// ---------------------------------------------------------------------------

/** Extract the subject/title from an activity event. */
function getActivityTitle(event: NostrEvent): string {
  if (event.kind === PATCH_KIND) return extractPatchSubject(event);

  const subject = event.tags.find(([t]) => t === "subject")?.[1];
  if (subject) return subject;

  if (event.kind === COMMENT_KIND || event.kind === COVER_NOTE_KIND) {
    const firstLine = event.content.split("\n")[0].trim();
    return firstLine.length > 120
      ? firstLine.slice(0, 120) + "…"
      : firstLine || "(empty)";
  }

  return "(untitled)";
}

/**
 * Extract the repo coordinate from an activity event.
 * Issues/patches/PRs/status events use an `a` tag pointing to the repo.
 * Comments use an `a` tag (lowercase) for the repo coord.
 */
function getRepoCoord(event: NostrEvent): string | undefined {
  // Direct `a` tag pointing to a repo (kind 30617)
  const aTag = event.tags.find(([t]) => t === "a")?.[1];
  if (aTag?.startsWith("30617:")) return aTag;

  // NIP-22 comments: uppercase `A` = root event coord (may be a repo)
  const upperA = event.tags.find(([t]) => t === "A")?.[1];
  if (upperA?.startsWith("30617:")) return upperA;

  return undefined;
}

/** Build the navigation path for an activity event. */
function getActivityPath(event: NostrEvent): string {
  return `/${eventIdToNevent(event.id)}`;
}

// ---------------------------------------------------------------------------
// Verb + description helpers
// ---------------------------------------------------------------------------

interface ActivityDescription {
  /** Short verb phrase, e.g. "opened issue" */
  verb: string;
  /** The title / subject to display as the main line */
  title: string;
  /**
   * Optional secondary label shown between verb and repo badge.
   * e.g. "on issue: Fix the parser" for a comment.
   */
  parentLabel?: string;
}

/**
 * Hook: resolve the parent event title for a comment or cover note.
 * Returns undefined while loading or when not found.
 */
function useParentTitle(event: NostrEvent): string | undefined {
  const store = useEventStore();

  // For comments: the immediate parent `e` tag (lowercase) is the item
  const eTag = event.tags.find(([t]) => t === "e")?.[1];
  // For status events: same — `e` tag points to the root item
  const parentId = eTag;

  return use$(() => {
    if (!parentId) return undefined;
    const filter: Filter = { ids: [parentId] };
    return store.timeline([filter]).pipe(
      map((events) => {
        const ev = events[0];
        if (!ev) return undefined;
        return extractSubject(ev);
      }),
    );
  }, [parentId, store]);
}

function activityDescription(
  event: NostrEvent,
): Omit<ActivityDescription, "parentLabel"> {
  switch (event.kind) {
    case ISSUE_KIND:
      return { verb: "opened issue", title: getActivityTitle(event) };
    case PATCH_KIND:
      return { verb: "submitted patch", title: getActivityTitle(event) };
    case PR_KIND:
      return { verb: "opened PR", title: getActivityTitle(event) };
    case COMMENT_KIND:
      return { verb: "commented", title: getActivityTitle(event) };
    case COVER_NOTE_KIND:
      return { verb: "posted cover note", title: getActivityTitle(event) };
    case STATUS_OPEN:
      return { verb: "reopened", title: getActivityTitle(event) };
    case STATUS_RESOLVED:
      return { verb: "resolved", title: getActivityTitle(event) };
    case STATUS_CLOSED:
      return { verb: "closed", title: getActivityTitle(event) };
    case STATUS_DRAFT:
      return { verb: "marked as draft", title: getActivityTitle(event) };
    default:
      return { verb: "activity", title: getActivityTitle(event) };
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ActivityIcon({ kind }: { kind: number }) {
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
    case COVER_NOTE_KIND:
      return (
        <div className="p-1.5 rounded-md bg-sky-500/10 shrink-0">
          <StickyNote className="h-3.5 w-3.5 text-sky-500" />
        </div>
      );
    case STATUS_OPEN:
      return (
        <div className="p-1.5 rounded-md bg-blue-500/10 shrink-0">
          <CircleDot className="h-3.5 w-3.5 text-blue-500" />
        </div>
      );
    case STATUS_RESOLVED:
      return (
        <div className="p-1.5 rounded-md bg-emerald-500/10 shrink-0">
          <GitMerge className="h-3.5 w-3.5 text-emerald-500" />
        </div>
      );
    case STATUS_CLOSED:
      return (
        <div className="p-1.5 rounded-md bg-red-500/10 shrink-0">
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        </div>
      );
    case STATUS_DRAFT:
      return (
        <div className="p-1.5 rounded-md bg-muted shrink-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
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

// ---------------------------------------------------------------------------
// ActivityItem
// ---------------------------------------------------------------------------

/**
 * Determine the kind of the item a status/comment/cover-note refers to.
 * Returns the `k` tag value (lowercase) as a number, or undefined.
 */
function getParentKind(event: NostrEvent): number | undefined {
  const kTag = event.tags.find(([t]) => t === "k")?.[1];
  return kTag ? parseInt(kTag, 10) : undefined;
}

function parentKindLabel(kind: number | undefined): string {
  switch (kind) {
    case ISSUE_KIND:
      return "issue";
    case PATCH_KIND:
      return "patch";
    case PR_KIND:
      return "PR";
    default:
      return "item";
  }
}

/** True for event kinds whose own content is not the primary title. */
function isSecondaryEvent(kind: number): boolean {
  return (
    kind === COMMENT_KIND ||
    kind === COVER_NOTE_KIND ||
    kind === STATUS_OPEN ||
    kind === STATUS_RESOLVED ||
    kind === STATUS_CLOSED ||
    kind === STATUS_DRAFT
  );
}

function ActivityItem({ event }: { event: NostrEvent }) {
  const { verb, title: ownTitle } = activityDescription(event);
  const repoCoord = getRepoCoord(event);
  const path = getActivityPath(event);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  const needsParentContext = isSecondaryEvent(event.kind);

  // Always call the hook (rules of hooks) — pass empty tags when not needed
  // so parentId is undefined and the observable returns undefined immediately.
  const parentTitle = useParentTitle(
    needsParentContext ? event : { ...event, tags: [] },
  );
  const parentKind = needsParentContext ? getParentKind(event) : undefined;
  const itemLabel = parentKindLabel(parentKind);

  // For status events and cover notes: the parent title IS the main title.
  // For comments: the comment snippet is the main title; parent is context.
  const isStatusOrCoverNote = event.kind !== COMMENT_KIND && needsParentContext;

  const displayTitle = isStatusOrCoverNote
    ? (parentTitle ?? ownTitle)
    : ownTitle;

  // Context line shown below the verb for comments
  let contextLine: string | undefined;
  if (event.kind === COMMENT_KIND) {
    if (parentTitle) {
      contextLine = `on ${itemLabel}: ${parentTitle.length > 60 ? parentTitle.slice(0, 60) + "…" : parentTitle}`;
    } else {
      contextLine = `on ${itemLabel}`;
    }
  } else if (event.kind === COVER_NOTE_KIND) {
    if (parentTitle) {
      contextLine = `on ${itemLabel}: ${parentTitle.length > 60 ? parentTitle.slice(0, 60) + "…" : parentTitle}`;
    } else {
      contextLine = `on ${itemLabel}`;
    }
  }

  return (
    <Link to={path} className="group block">
      <div className="flex items-start gap-3 py-2.5 px-1 rounded-lg transition-colors hover:bg-muted/40">
        <ActivityIcon kind={event.kind} />

        <div className="flex-1 min-w-0">
          {/* Main title line */}
          <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors mb-0.5">
            {displayTitle}
          </p>

          {/* Verb + context + repo badge + timestamp */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            <span className="shrink-0">{verb}</span>

            {contextLine && (
              <span className="shrink-0 text-muted-foreground/70">
                {contextLine}
              </span>
            )}

            {repoCoord && (
              <>
                <span className="shrink-0 text-muted-foreground/40">in</span>
                <span onClick={(e) => e.preventDefault()} className="shrink-0">
                  <RepoBadge coord={repoCoord} className="text-[10px]" />
                </span>
              </>
            )}

            <span className="text-muted-foreground/50 ml-auto shrink-0">
              {timeAgo}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Repo group within a time bucket
// ---------------------------------------------------------------------------

interface RepoGroup {
  repoCoord: string | undefined;
  events: NostrEvent[];
}

function groupByRepo(events: NostrEvent[]): RepoGroup[] {
  const groups = new Map<string, NostrEvent[]>();
  const NO_REPO = "__no_repo__";

  for (const ev of events) {
    const coord = getRepoCoord(ev) ?? NO_REPO;
    const existing = groups.get(coord) ?? [];
    existing.push(ev);
    groups.set(coord, existing);
  }

  return Array.from(groups.entries()).map(([coord, evs]) => ({
    repoCoord: coord === NO_REPO ? undefined : coord,
    events: evs,
  }));
}

function RepoGroupSection({ group }: { group: RepoGroup }) {
  return (
    <div>
      {group.repoCoord && (
        <div className="flex items-center gap-2 mb-1 px-1">
          <RepoBadge coord={group.repoCoord} className="text-xs" />
          <div className="flex-1 h-px bg-border/40" />
        </div>
      )}
      <div className="divide-y divide-border/20">
        {group.events.map((ev) => (
          <ActivityItem key={ev.id} event={ev} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time bucket section
// ---------------------------------------------------------------------------

interface TimeBucketData {
  bucket: TimeBucket;
  events: NostrEvent[];
}

function TimeBucketSection({ bucket, events }: TimeBucketData) {
  const repoGroups = groupByRepo(events);

  return (
    <div>
      {/* Bucket header */}
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
          {BUCKET_LABELS[bucket]}
        </h3>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      <div className="space-y-3">
        {repoGroups.map((group, i) => (
          <RepoGroupSection
            key={group.repoCoord ?? `no-repo-${i}`}
            group={group}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ActivitySkeleton() {
  return (
    <div className="flex items-start gap-3 py-2.5 px-1">
      <Skeleton className="h-7 w-7 rounded-md shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-3 w-14 ml-auto" />
        </div>
      </div>
    </div>
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
      <div className="space-y-6">
        {/* Fake bucket header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="h-3 w-12" />
            <div className="flex-1 h-px bg-border/40" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <ActivitySkeleton key={i} />
            ))}
          </div>
        </div>
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
            Issues, patches, PRs, comments, and status changes will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group events into time buckets, preserving newest-first order within each
  const bucketOrder: TimeBucket[] = [
    "today",
    "this-week",
    "last-week",
    "last-month",
    "older",
  ];
  const bucketMap = new Map<TimeBucket, NostrEvent[]>();
  for (const ev of events) {
    const bucket = getTimeBucket(ev.created_at);
    const existing = bucketMap.get(bucket) ?? [];
    existing.push(ev);
    bucketMap.set(bucket, existing);
  }

  const buckets: TimeBucketData[] = bucketOrder
    .filter((b) => bucketMap.has(b))
    .map((b) => ({ bucket: b, events: bucketMap.get(b)! }));

  return (
    <div className="space-y-8">
      {buckets.map(({ bucket, events: bucketEvents }) => (
        <TimeBucketSection key={bucket} bucket={bucket} events={bucketEvents} />
      ))}
    </div>
  );
}
