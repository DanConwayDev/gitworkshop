/**
 * EmbeddedEventPreview — renders a compact inline preview of a referenced
 * Nostr event inside note/comment content.
 *
 * Design mirrors gitworkshop's EmbeddedEvent + EventWrapperLite pattern:
 *
 *   - Git events (issue, patch, PR, repo) get a custom "lite" preview that
 *     shows the author badge, a kind-specific summary line, and a timestamp.
 *   - All other events fall back to a generic card that shows the author,
 *     a truncated content snippet, and a timestamp.
 *   - While loading, a skeleton placeholder is shown.
 *
 * The component is intentionally lightweight — it does NOT render full event
 * cards with reactions, zaps, or thread trees. Those belong on dedicated pages.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { map } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { UserLink } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/StatusIcon";
import { cn } from "@/lib/utils";
import {
  useEmbeddedEventById,
  useEmbeddedEventByAddress,
} from "@/hooks/useEmbeddedEvent";
import {
  ISSUE_KIND,
  PATCH_KIND,
  PR_KIND,
  REPO_KIND,
  STATUS_KINDS,
  DELETION_KIND,
  LABEL_KIND,
  SUBJECT_LABEL_NAMESPACE,
  kindToStatus,
  extractSubject,
  type IssueStatus,
} from "@/lib/nip34";
import { useRepoPath } from "@/hooks/useRepoPath";
import { eventIdToNevent } from "@/lib/routeUtils";
import { getTagValue } from "applesauce-core/helpers/event";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import { nip34EssentialsLoader } from "@/services/nostr";
import { gitIndexRelays } from "@/services/settings";
import type { Filter } from "applesauce-core/helpers";

interface EmbeddedItemEssentials {
  status: IssueStatus;
  /** Current subject after applying authorised renames, or undefined while loading. */
  currentSubject: string | undefined;
}

/**
 * Fires the essentials loader for a NIP-34 item and reactively derives its
 * current status and subject from the EventStore.
 *
 * Uses the relay hints from the event pointer (if any) plus the configured
 * git index relay as a fallback.
 *
 * Auth: no author/maintainer filtering is applied here — the repo announcement
 * is not fetched in this lightweight context so the maintainer set is unknown.
 * Any status or rename event referencing this item is accepted. The full auth
 * rules are enforced on the detail page when the user clicks through.
 * Deletion (kind:5) is the one exception: NIP-09 requires it to be authored
 * by the item author, so we still enforce that check.
 *
 * @param itemId          - The event ID of the issue / patch / PR
 * @param relayHints      - Optional relay hints from the event pointer
 * @param authorPubkey    - The pubkey of the item author (for deletion auth only)
 * @param originalSubject - The subject extracted directly from the root event
 */
function useEmbeddedItemEssentials(
  itemId: string,
  relayHints: string[] | undefined,
  authorPubkey: string,
  originalSubject: string,
): EmbeddedItemEssentials {
  const store = useEventStore();

  // Fire the essentials loader once on mount (or when itemId changes).
  useEffect(() => {
    const relays = [...(relayHints ?? []), ...gitIndexRelays.getValue()];
    if (relays.length === 0) return;
    const sub = nip34EssentialsLoader({ value: itemId, relays }).subscribe();
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  // Reactively watch for status, deletion, and label events in the store.
  const essentials = use$(() => {
    const essentialsFilter: Filter[] = [
      {
        kinds: [...STATUS_KINDS, DELETION_KIND, LABEL_KIND],
        "#e": [itemId],
      } as Filter,
    ];
    return store.timeline(essentialsFilter).pipe(
      map((events): EmbeddedItemEssentials => {
        // ── Status ──────────────────────────────────────────────────────────
        // Deletion by the item author takes precedence over all status events.
        // NIP-09: only the original author's deletion is valid.
        const isDeleted = events.some(
          (ev) => ev.kind === DELETION_KIND && ev.pubkey === authorPubkey,
        );

        let status: IssueStatus = "open";
        if (isDeleted) {
          status = "deleted";
        } else {
          // Accept any status event — no maintainer check without the repo event.
          let latest: { kind: number; createdAt: number } | undefined;
          for (const ev of events) {
            if ((STATUS_KINDS as readonly number[]).includes(ev.kind)) {
              if (!latest || ev.created_at > latest.createdAt) {
                latest = { kind: ev.kind, createdAt: ev.created_at };
              }
            }
          }
          if (latest) status = kindToStatus(latest.kind);
        }

        // ── Subject renames ─────────────────────────────────────────────────
        // Accept any rename event — no maintainer check without the repo event.
        // Sorted oldest-first; the last one wins.
        const renames = events
          .filter(
            (ev) =>
              ev.kind === LABEL_KIND &&
              ev.tags.some(
                ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
              ),
          )
          .sort(
            (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
          );

        const latestRename = renames[renames.length - 1];
        const currentSubject = latestRename
          ? (latestRename.tags.find(
              ([t, , ns]) => t === "l" && ns === SUBJECT_LABEL_NAMESPACE,
            )?.[1] ?? originalSubject)
          : originalSubject;

        return { status, currentSubject };
      }),
    );
  }, [itemId, authorPubkey, originalSubject, store]);

  return essentials ?? { status: "open", currentSubject: undefined };
}

// ---------------------------------------------------------------------------
// Shared "lite wrapper" shell — author badge + timestamp + content slot
// ---------------------------------------------------------------------------

function EventWrapperLite({
  event,
  children,
  href,
}: {
  event: NostrEvent;
  children: React.ReactNode;
  href?: string;
}) {
  const timeAgo = formatDistanceToNow(new Date(event.created_at * 1000), {
    addSuffix: true,
  });

  return (
    <div className="flex items-start justify-between gap-2 py-1 px-0.5 text-sm">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {children}
        <span className="text-muted-foreground/60">by</span>
        <UserLink
          pubkey={event.pubkey}
          avatarSize="xs"
          nameClassName="text-xs"
        />
      </div>
      <span className="text-xs text-muted-foreground/50 shrink-0 whitespace-nowrap">
        {href ? (
          <Link to={href} className="hover:underline">
            {timeAgo}
          </Link>
        ) : (
          timeAgo
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kind-specific preview content
// ---------------------------------------------------------------------------

function IssuePreviewContent({
  event,
  relayHints,
}: {
  event: NostrEvent;
  relayHints?: string[];
}) {
  const originalSubject = extractSubject(event);
  const { status, currentSubject } = useEmbeddedItemEssentials(
    event.id,
    relayHints,
    event.pubkey,
    originalSubject,
  );
  const subject = currentSubject ?? originalSubject;

  const repoCoord = event.tags.find(([t]) => t === "a")?.[1];
  const repoId = repoCoord?.split(":")?.[2];
  const repoPubkey = repoCoord?.split(":")?.[1];

  const repoPath = useRepoPath(repoPubkey ?? "", repoId ?? "", []);
  const nevent = eventIdToNevent(event.id);
  const href = repoCoord ? `${repoPath}/issues/${nevent}` : `/${nevent}`;

  return (
    <EventWrapperLite event={event} href={href}>
      <StatusIcon
        status={status}
        variant="issue"
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="text-muted-foreground/60 text-xs">Git Issue</span>
      {repoId && (
        <>
          <span className="text-muted-foreground/40 text-xs">for</span>
          <Link
            to={repoPath}
            className="text-xs text-muted-foreground/70 hover:underline font-mono"
          >
            {repoId}
          </Link>
          <span className="text-muted-foreground/40">:</span>
        </>
      )}
      <Link
        to={href}
        className="text-foreground hover:underline font-medium truncate"
      >
        {subject || "(untitled)"}
      </Link>
    </EventWrapperLite>
  );
}

function PatchPreviewContent({
  event,
  isPR,
  relayHints,
}: {
  event: NostrEvent;
  isPR: boolean;
  relayHints?: string[];
}) {
  const originalSubject = extractSubject(event);
  const variant = isPR ? "pr" : "patch";
  const { status, currentSubject } = useEmbeddedItemEssentials(
    event.id,
    relayHints,
    event.pubkey,
    originalSubject,
  );
  const subject = currentSubject ?? originalSubject;

  const repoCoord = event.tags.find(([t]) => t === "a")?.[1];
  const repoId = repoCoord?.split(":")?.[2];
  const repoPubkey = repoCoord?.split(":")?.[1];

  const repoPath = useRepoPath(repoPubkey ?? "", repoId ?? "", []);
  const nevent = eventIdToNevent(event.id);
  const href = repoCoord ? `${repoPath}/prs/${nevent}` : `/${nevent}`;
  const label = isPR ? "Pull Request" : "Patch";

  return (
    <EventWrapperLite event={event} href={href}>
      <StatusIcon
        status={status}
        variant={variant}
        className="h-3.5 w-3.5 shrink-0"
      />
      <span className="text-muted-foreground/60 text-xs">Git {label}</span>
      {repoId && (
        <>
          <span className="text-muted-foreground/40 text-xs">for</span>
          <Link
            to={repoPath}
            className="text-xs text-muted-foreground/70 hover:underline font-mono"
          >
            {repoId}
          </Link>
          <span className="text-muted-foreground/40">:</span>
        </>
      )}
      <Link
        to={href}
        className="text-foreground hover:underline font-medium truncate"
      >
        {subject || "(untitled)"}
      </Link>
    </EventWrapperLite>
  );
}

function RepoPreviewContent({ event }: { event: NostrEvent }) {
  const dTag = getTagValue(event, "d") ?? "";
  const repoPath = useRepoPath(event.pubkey, dTag, []);

  return (
    <EventWrapperLite event={event} href={repoPath}>
      <span className="text-muted-foreground/60 text-xs">Git Repository:</span>
      <Link
        to={repoPath}
        className="text-foreground hover:underline font-medium font-mono"
      >
        {dTag || "(unnamed)"}
      </Link>
    </EventWrapperLite>
  );
}

function GenericPreviewContent({ event }: { event: NostrEvent }) {
  const encoded = nip19.neventEncode({
    id: event.id,
    kind: event.kind,
    author: event.pubkey,
  });
  const href = `/${encoded}`;
  const snippet = event.content.slice(0, 120).trim();

  return (
    <EventWrapperLite event={event} href={href}>
      <span className="text-muted-foreground/60 text-xs">
        kind:{event.kind}
      </span>
      {snippet && (
        <Link to={href} className="text-foreground/80 hover:underline truncate">
          {snippet}
          {event.content.length > 120 ? "…" : ""}
        </Link>
      )}
    </EventWrapperLite>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher — picks the right preview based on event kind
// ---------------------------------------------------------------------------

function EventPreviewDispatcher({
  event,
  relayHints,
}: {
  event: NostrEvent;
  relayHints?: string[];
}) {
  if (event.kind === ISSUE_KIND) {
    return <IssuePreviewContent event={event} relayHints={relayHints} />;
  }
  if (event.kind === PATCH_KIND) {
    return (
      <PatchPreviewContent event={event} isPR={false} relayHints={relayHints} />
    );
  }
  if (event.kind === PR_KIND) {
    return (
      <PatchPreviewContent event={event} isPR={true} relayHints={relayHints} />
    );
  }
  if (event.kind === REPO_KIND) {
    return <RepoPreviewContent event={event} />;
  }
  return <GenericPreviewContent event={event} />;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PreviewSkeleton() {
  return (
    <div className="flex items-center gap-2 py-1 px-0.5">
      <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-3 w-16 ml-auto" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer container — shared border/bg styling
// ---------------------------------------------------------------------------

function PreviewContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-1 text-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public API — two entry points matching the two pointer types
// ---------------------------------------------------------------------------

/**
 * Render an embedded preview for a nevent / note pointer.
 */
export function EmbeddedEventByIdPreview({
  pointer,
  className,
}: {
  pointer: EventPointer;
  className?: string;
}) {
  const event = useEmbeddedEventById(pointer);

  return (
    <PreviewContainer className={className}>
      {event ? (
        <EventPreviewDispatcher event={event} relayHints={pointer.relays} />
      ) : (
        <PreviewSkeleton />
      )}
    </PreviewContainer>
  );
}

/**
 * Render an embedded preview for an naddr pointer.
 */
export function EmbeddedEventByAddressPreview({
  pointer,
  className,
}: {
  pointer: AddressPointer;
  className?: string;
}) {
  const event = useEmbeddedEventByAddress(pointer);

  return (
    <PreviewContainer className={className}>
      {event ? (
        <EventPreviewDispatcher event={event} relayHints={pointer.relays} />
      ) : (
        <PreviewSkeleton />
      )}
    </PreviewContainer>
  );
}
