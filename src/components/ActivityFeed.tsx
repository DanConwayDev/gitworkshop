/**
 * ActivityFeed — renders a user's recent git activity.
 *
 * Three-level collapsible hierarchy:
 *
 *   Level 1 — Repo row (collapsed by default)
 *     "user/repo  ·  2 PRs  ·  4 issues  ·  3 comments"
 *     Click to expand → shows Level 2 rows
 *
 *   Level 2 — Item row (PR / issue / patch, collapsed by default)
 *     "[Icon] Fix the parser bug  ·  3 interactions"
 *     Click to expand → shows Level 3 rows
 *
 *   Level 3 — Individual activity event
 *     "opened issue  ·  3 days ago"
 *     "commented: …snippet…  ·  2 days ago"
 *     "closed  ·  1 day ago"
 *
 * Events that have no parent item (e.g. a standalone issue with no comments)
 * still appear as a Level 2 row with a single Level 3 entry.
 *
 * The component is stateless w.r.t. data — it receives raw events from
 * useUserActivity and renders them.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  startOfDay,
  startOfWeek,
  subWeeks,
  startOfMonth,
  subMonths,
  formatDistanceToNow,
  format,
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
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

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
 */
function getRepoCoord(event: NostrEvent): string | undefined {
  const aTag = event.tags.find(([t]) => t === "a")?.[1];
  if (aTag?.startsWith("30617:")) return aTag;

  const upperA = event.tags.find(([t]) => t === "A")?.[1];
  if (upperA?.startsWith("30617:")) return upperA;

  return undefined;
}

/** Build the navigation path for an activity event. */
function getActivityPath(event: NostrEvent): string {
  return `/${eventIdToNevent(event.id)}`;
}

/** True for event kinds that are "secondary" — they act on a parent item. */
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

/** True for event kinds that are "root" items (issues, patches, PRs). */
function isRootItem(kind: number): boolean {
  return kind === ISSUE_KIND || kind === PATCH_KIND || kind === PR_KIND;
}

/**
 * Get the root event ID that a secondary event references.
 *
 * Resolution order:
 *   1. NIP-22 comments (kind 1111): uppercase `E` tag — NIP-22 root pointer.
 *      This directly identifies the issue/PR/patch that was commented on.
 *   2. Status events (1630-1633) and cover notes (1624): lowercase `e` tag
 *      with a "root" marker, falling back to the first lowercase `e` tag.
 *      (These events are not NIP-22 and don't use uppercase E.)
 */
function getParentEventId(event: NostrEvent): string | undefined {
  // NIP-22 comments use uppercase E for the thread root
  if (event.kind === COMMENT_KIND) {
    return event.tags.find(([t]) => t === "E")?.[1];
  }

  // Status events and cover notes: prefer e tag with "root" marker
  const rootMarked = event.tags.find(
    ([t, , , marker]) => t === "e" && marker === "root",
  )?.[1];
  if (rootMarked) return rootMarked;

  // Fall back to first e tag
  return event.tags.find(([t]) => t === "e")?.[1];
}

function getParentKind(event: NostrEvent): number | undefined {
  // NIP-22 comments use uppercase K for the root event's kind
  if (event.kind === COMMENT_KIND) {
    const kTag = event.tags.find(([t]) => t === "K")?.[1];
    return kTag ? parseInt(kTag, 10) : undefined;
  }
  // Status events and cover notes use lowercase k
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

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * An "item group" is a root item (issue/patch/PR) plus all secondary events
 * that reference it. If a secondary event has no known root item in the
 * current event set, it forms its own synthetic group.
 */
interface ItemGroup {
  /** The root event (issue/patch/PR), if known. */
  rootEvent: NostrEvent | undefined;
  /** Synthetic title when rootEvent is absent. */
  fallbackTitle: string;
  /** The kind of the root item (for icon/label). */
  rootKind: number;
  /** All events in this group, newest-first. */
  events: NostrEvent[];
}

interface RepoGroup {
  repoCoord: string | undefined;
  items: ItemGroup[];
}

function buildItemGroups(events: NostrEvent[]): ItemGroup[] {
  // Index root items by their event ID
  const rootById = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (isRootItem(ev.kind)) {
      rootById.set(ev.id, ev);
    }
  }

  // Map from root item ID → collected events (root + secondaries)
  const groupMap = new Map<string, NostrEvent[]>();
  // Orphan secondaries whose parent isn't in our event set
  const orphans: NostrEvent[] = [];

  for (const ev of events) {
    if (isRootItem(ev.kind)) {
      // Ensure the root item has a group entry
      if (!groupMap.has(ev.id)) groupMap.set(ev.id, []);
      groupMap.get(ev.id)!.push(ev);
    } else if (isSecondaryEvent(ev.kind)) {
      const parentId = getParentEventId(ev);
      if (parentId && rootById.has(parentId)) {
        if (!groupMap.has(parentId)) groupMap.set(parentId, []);
        groupMap.get(parentId)!.push(ev);
      } else if (parentId) {
        // Parent not in our set — group orphans by parent ID
        if (!groupMap.has(parentId)) groupMap.set(parentId, []);
        groupMap.get(parentId)!.push(ev);
      } else {
        orphans.push(ev);
      }
    }
  }

  const groups: ItemGroup[] = [];

  for (const [id, evs] of groupMap.entries()) {
    const root = rootById.get(id);
    const sorted = [...evs].sort((a, b) => b.created_at - a.created_at);

    // Determine root kind: from root event, or from `k` tag of first secondary
    let rootKind = root?.kind ?? ISSUE_KIND;
    if (!root && sorted.length > 0) {
      rootKind = getParentKind(sorted[0]) ?? ISSUE_KIND;
    }

    groups.push({
      rootEvent: root,
      fallbackTitle: root
        ? getActivityTitle(root)
        : sorted[0]
          ? `(${parentKindLabel(getParentKind(sorted[0]))})`
          : "(unknown)",
      rootKind,
      events: sorted,
    });
  }

  // Each orphan (no parent ID) becomes its own single-event group
  for (const ev of orphans) {
    groups.push({
      rootEvent: undefined,
      fallbackTitle: getActivityTitle(ev),
      rootKind: getParentKind(ev) ?? ev.kind,
      events: [ev],
    });
  }

  // Sort groups by most-recent event
  groups.sort((a, b) => {
    const aTs = a.events[0]?.created_at ?? 0;
    const bTs = b.events[0]?.created_at ?? 0;
    return bTs - aTs;
  });

  return groups;
}

/**
 * Resolve the repo coordinate for an item group.
 *
 * Priority:
 *   1. The rootEvent's own `a` / `A` tag (most reliable — root items always
 *      carry the repo coord directly).
 *   2. Any secondary event in the group that happens to carry an `a` / `A`
 *      tag (cover notes and some status events include it).
 *   3. undefined — repo unknown (will be shown as "No repository").
 */
function resolveGroupRepoCoord(group: ItemGroup): string | undefined {
  // Root event is the authoritative source
  if (group.rootEvent) {
    const coord = getRepoCoord(group.rootEvent);
    if (coord) return coord;
  }

  // Fall back to any secondary event that carries the tag
  for (const ev of group.events) {
    const coord = getRepoCoord(ev);
    if (coord) return coord;
  }

  return undefined;
}

function groupByRepo(events: NostrEvent[]): RepoGroup[] {
  // Build item groups first (globally), so secondary events are attached to
  // their root item before we try to resolve the repo coord. If we split by
  // repo first, secondary events (which lack an `a` tag) land in __no_repo__
  // and never get matched to their root item.
  const itemGroups = buildItemGroups(events);

  const repoMap = new Map<string, ItemGroup[]>();
  const NO_REPO = "__no_repo__";

  for (const group of itemGroups) {
    const coord = resolveGroupRepoCoord(group) ?? NO_REPO;
    const existing = repoMap.get(coord) ?? [];
    existing.push(group);
    repoMap.set(coord, existing);
  }

  return Array.from(repoMap.entries()).map(([coord, items]) => ({
    repoCoord: coord === NO_REPO ? undefined : coord,
    items,
  }));
}

// ---------------------------------------------------------------------------
// Summary helpers (for the repo-level collapsed row)
// ---------------------------------------------------------------------------

interface KindCounts {
  issues: number;
  patches: number;
  prs: number;
  comments: number;
  statusChanges: number;
}

function countKinds(items: ItemGroup[]): KindCounts {
  const counts: KindCounts = {
    issues: 0,
    patches: 0,
    prs: 0,
    comments: 0,
    statusChanges: 0,
  };

  for (const item of items) {
    if (item.rootKind === ISSUE_KIND) counts.issues++;
    else if (item.rootKind === PATCH_KIND) counts.patches++;
    else if (item.rootKind === PR_KIND) counts.prs++;

    for (const ev of item.events) {
      if (ev.kind === COMMENT_KIND || ev.kind === COVER_NOTE_KIND)
        counts.comments++;
      if (
        ev.kind === STATUS_OPEN ||
        ev.kind === STATUS_RESOLVED ||
        ev.kind === STATUS_CLOSED ||
        ev.kind === STATUS_DRAFT
      )
        counts.statusChanges++;
    }
  }

  return counts;
}

function buildSummaryParts(counts: KindCounts): string[] {
  const parts: string[] = [];
  if (counts.prs > 0)
    parts.push(`${counts.prs} ${counts.prs === 1 ? "PR" : "PRs"}`);
  if (counts.issues > 0)
    parts.push(`${counts.issues} ${counts.issues === 1 ? "issue" : "issues"}`);
  if (counts.patches > 0)
    parts.push(
      `${counts.patches} ${counts.patches === 1 ? "patch" : "patches"}`,
    );
  if (counts.comments > 0)
    parts.push(
      `${counts.comments} ${counts.comments === 1 ? "comment" : "comments"}`,
    );
  if (counts.statusChanges > 0)
    parts.push(
      `${counts.statusChanges} ${counts.statusChanges === 1 ? "status change" : "status changes"}`,
    );
  return parts;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ItemIcon({ kind, className }: { kind: number; className?: string }) {
  const base = cn("shrink-0", className);
  switch (kind) {
    case ISSUE_KIND:
      return (
        <div className={cn("p-1.5 rounded-md bg-blue-500/10", base)}>
          <CircleDot className="h-3.5 w-3.5 text-blue-500" />
        </div>
      );
    case PATCH_KIND:
      return (
        <div className={cn("p-1.5 rounded-md bg-amber-500/10", base)}>
          <GitCommitHorizontal className="h-3.5 w-3.5 text-amber-500" />
        </div>
      );
    case PR_KIND:
      return (
        <div className={cn("p-1.5 rounded-md bg-purple-500/10", base)}>
          <GitPullRequest className="h-3.5 w-3.5 text-purple-500" />
        </div>
      );
    case COMMENT_KIND:
      return (
        <div className={cn("p-1.5 rounded-md bg-emerald-500/10", base)}>
          <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
        </div>
      );
    case COVER_NOTE_KIND:
      return (
        <div className={cn("p-1.5 rounded-md bg-sky-500/10", base)}>
          <StickyNote className="h-3.5 w-3.5 text-sky-500" />
        </div>
      );
    case STATUS_OPEN:
      return (
        <div className={cn("p-1.5 rounded-md bg-blue-500/10", base)}>
          <CircleDot className="h-3.5 w-3.5 text-blue-500" />
        </div>
      );
    case STATUS_RESOLVED:
      return (
        <div className={cn("p-1.5 rounded-md bg-emerald-500/10", base)}>
          <GitMerge className="h-3.5 w-3.5 text-emerald-500" />
        </div>
      );
    case STATUS_CLOSED:
      return (
        <div className={cn("p-1.5 rounded-md bg-red-500/10", base)}>
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        </div>
      );
    case STATUS_DRAFT:
      return (
        <div className={cn("p-1.5 rounded-md bg-muted", base)}>
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      );
    default:
      return (
        <div className={cn("p-1.5 rounded-md bg-muted", base)}>
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Level 3 — individual activity event row
// ---------------------------------------------------------------------------

/** Short verb for an individual event in the expanded item view. */
function eventVerb(event: NostrEvent): string {
  switch (event.kind) {
    case ISSUE_KIND:
      return "opened issue";
    case PATCH_KIND:
      return "submitted patch";
    case PR_KIND:
      return "opened PR";
    case COMMENT_KIND:
      return "commented";
    case COVER_NOTE_KIND:
      return "posted cover note";
    case STATUS_OPEN:
      return "reopened";
    case STATUS_RESOLVED:
      return "resolved";
    case STATUS_CLOSED:
      return "closed";
    case STATUS_DRAFT:
      return "marked as draft";
    default:
      return "activity";
  }
}

/**
 * Hook: resolve the parent event (issue/PR/patch) for a secondary event.
 * Returns the event from the store if present, undefined otherwise.
 */
function useParentEvent(parentId: string | undefined): NostrEvent | undefined {
  const store = useEventStore();
  return use$(() => {
    if (!parentId) return undefined;
    const filter: Filter = { ids: [parentId] };
    return store.timeline([filter]).pipe(map((evs) => evs[0]));
  }, [parentId, store]);
}

/** Hook: resolve the parent event title for a comment or cover note. */
function useParentTitle(event: NostrEvent): string | undefined {
  const parentId = isSecondaryEvent(event.kind)
    ? getParentEventId(event)
    : undefined;
  const parentEvent = useParentEvent(parentId);
  return parentEvent ? extractSubject(parentEvent) : undefined;
}

function ActivityEventRow({ event }: { event: NostrEvent }) {
  const path = getActivityPath(event);
  const verb = eventVerb(event);
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });
  const fullDate = format(
    new Date(event.created_at * 1000),
    "MMM d, yyyy 'at' h:mm a",
  );

  // For comments/cover-notes: show a snippet of the content
  const isComment =
    event.kind === COMMENT_KIND || event.kind === COVER_NOTE_KIND;
  const snippet = isComment
    ? event.content.split("\n")[0].trim().slice(0, 100) +
      (event.content.length > 100 ? "…" : "")
    : undefined;

  // For secondary events without a root in our set, show parent context
  const parentTitle = useParentTitle(event);
  const parentKind = isSecondaryEvent(event.kind)
    ? getParentKind(event)
    : undefined;

  return (
    <Link
      to={path}
      className="group flex items-start gap-2.5 py-2 px-2 rounded-md hover:bg-muted/40 transition-colors"
    >
      <ItemIcon kind={event.kind} className="mt-0.5" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground/80 group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
            {verb}
          </span>
          {snippet && (
            <span className="text-xs text-muted-foreground truncate max-w-[280px]">
              {snippet}
            </span>
          )}
          {!isComment && parentTitle && (
            <span className="text-xs text-muted-foreground/60">
              on {parentKindLabel(parentKind)}: {parentTitle.slice(0, 60)}
              {parentTitle.length > 60 ? "…" : ""}
            </span>
          )}
        </div>
        <p
          className="text-[11px] text-muted-foreground/50 mt-0.5"
          title={fullDate}
        >
          {timeAgo}
        </p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Level 2 — item row (PR / issue / patch)
// ---------------------------------------------------------------------------

function ItemGroupRow({ item }: { item: ItemGroup }) {
  const [expanded, setExpanded] = useState(false);

  // When the root item isn't in our event set, try to resolve it from the
  // store reactively (it may arrive later as events stream in).
  const orphanParentId = !item.rootEvent
    ? getParentEventId(item.events[0]!)
    : undefined;
  const resolvedParent = useParentEvent(orphanParentId);

  const effectiveRoot = item.rootEvent ?? resolvedParent;
  const title = effectiveRoot
    ? getActivityTitle(effectiveRoot)
    : item.fallbackTitle;
  const path = effectiveRoot ? getActivityPath(effectiveRoot) : undefined;

  // Count secondary events (interactions beyond the root opening)
  const secondaryCount = item.events.filter((ev) =>
    isSecondaryEvent(ev.kind),
  ).length;

  // Most recent event timestamp
  const latestTs = item.events[0]?.created_at;
  const timeAgo = latestTs
    ? formatDistanceToNow(new Date(latestTs * 1000), { addSuffix: true })
    : "";

  return (
    <div>
      {/* Item header row */}
      <div
        className={cn(
          "flex items-start gap-2.5 py-2 px-2 rounded-md transition-colors",
          item.events.length > 1
            ? "cursor-pointer hover:bg-muted/40"
            : "cursor-default",
        )}
        onClick={() => item.events.length > 1 && setExpanded((v) => !v)}
        role={item.events.length > 1 ? "button" : undefined}
        aria-expanded={item.events.length > 1 ? expanded : undefined}
      >
        {/* Expand chevron or spacer */}
        <div className="w-4 shrink-0 flex items-center justify-center mt-1">
          {item.events.length > 1 ? (
            expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
            )
          ) : null}
        </div>

        <ItemIcon kind={item.rootKind} className="mt-0.5" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            {/* Title — links to the root item if we have it */}
            {path ? (
              <Link
                to={path}
                className="text-sm font-medium leading-snug hover:text-pink-600 dark:hover:text-pink-400 transition-colors line-clamp-2"
                onClick={(e) => e.stopPropagation()}
              >
                {title}
              </Link>
            ) : (
              <span className="text-sm font-medium leading-snug text-muted-foreground line-clamp-2">
                {title}
              </span>
            )}

            {/* Interaction count badge */}
            {secondaryCount > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-4 shrink-0 font-normal"
              >
                {secondaryCount}{" "}
                {secondaryCount === 1 ? "interaction" : "interactions"}
              </Badge>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground/50 mt-0.5">
            {timeAgo}
          </p>
        </div>
      </div>

      {/* Expanded: individual activity events */}
      {expanded && (
        <div className="ml-6 pl-3 border-l border-border/40 space-y-0.5 mb-1">
          {item.events.map((ev) => (
            <ActivityEventRow key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 1 — repo group row
// ---------------------------------------------------------------------------

function RepoGroupSection({ group }: { group: RepoGroup }) {
  const [expanded, setExpanded] = useState(false);

  // When the repo coord couldn't be resolved from the activity events alone
  // (e.g. the user only has secondary events — comments/status — whose root
  // item wasn't in the fetched set), try to resolve it reactively from the
  // store. The root item may arrive later as events stream in.
  const orphanParentId =
    !group.repoCoord && group.items.length > 0
      ? getParentEventId(group.items[0]!.events[0]!)
      : undefined;
  const resolvedParent = useParentEvent(orphanParentId);
  const resolvedRepoCoord =
    group.repoCoord ??
    (resolvedParent ? getRepoCoord(resolvedParent) : undefined);

  const counts = countKinds(group.items);
  const summaryParts = buildSummaryParts(counts);

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Repo header — always visible, click to expand */}
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Chevron */}
        <div className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
        </div>

        {/* Repo badge or "No repository" */}
        {resolvedRepoCoord ? (
          <span onClick={(e) => e.stopPropagation()}>
            <RepoBadge
              coord={resolvedRepoCoord}
              className="text-xs font-medium"
            />
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            No repository
          </span>
        )}

        {/* Summary pills */}
        <div className="flex items-center gap-1.5 flex-wrap ml-1">
          {summaryParts.map((part) => (
            <span
              key={part}
              className="text-[11px] text-muted-foreground/70 bg-background/60 border border-border/40 rounded-full px-2 py-0.5 leading-none"
            >
              {part}
            </span>
          ))}
        </div>

        {/* Item count on the right */}
        <span className="ml-auto text-[11px] text-muted-foreground/40 shrink-0">
          {group.items.length} {group.items.length === 1 ? "item" : "items"}
        </span>
      </button>

      {/* Expanded: item rows */}
      {expanded && (
        <div className="divide-y divide-border/20 px-1 py-1">
          {group.items.map((item, i) => (
            <ItemGroupRow
              key={item.rootEvent?.id ?? `orphan-${i}`}
              item={item}
            />
          ))}
        </div>
      )}
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

      <div className="space-y-2">
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
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/30">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-4 w-32 rounded-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-4 w-12 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <Skeleton className="h-3 w-10 ml-auto" />
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
        <div>
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="h-3 w-12" />
            <div className="flex-1 h-px bg-border/40" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
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
