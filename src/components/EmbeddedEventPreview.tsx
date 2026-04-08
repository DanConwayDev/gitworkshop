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

import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
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
  extractSubject,
  extractPatchSubject,
} from "@/lib/nip34";
import { useRepoPath } from "@/hooks/useRepoPath";
import { eventIdToNevent } from "@/lib/routeUtils";
import { getTagValue } from "applesauce-core/helpers/event";

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

function IssuePreviewContent({ event }: { event: NostrEvent }) {
  const subject = extractSubject(event);
  const repoCoord = event.tags.find(([t]) => t === "a")?.[1];
  const repoId = repoCoord?.split(":")?.[2];
  const repoPubkey = repoCoord?.split(":")?.[1];

  const repoPath = useRepoPath(repoPubkey ?? "", repoId ?? "", []);
  const nevent = eventIdToNevent(event.id);
  const href = repoCoord ? `${repoPath}/issues/${nevent}` : `/${nevent}`;

  return (
    <EventWrapperLite event={event} href={href}>
      <StatusIcon
        status="open"
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
}: {
  event: NostrEvent;
  isPR: boolean;
}) {
  const subject = extractPatchSubject(event);
  const repoCoord = event.tags.find(([t]) => t === "a")?.[1];
  const repoId = repoCoord?.split(":")?.[2];
  const repoPubkey = repoCoord?.split(":")?.[1];

  const repoPath = useRepoPath(repoPubkey ?? "", repoId ?? "", []);
  const nevent = eventIdToNevent(event.id);
  const href = repoCoord ? `${repoPath}/prs/${nevent}` : `/${nevent}`;
  const label = isPR ? "Pull Request" : "Patch";

  return (
    <EventWrapperLite event={event} href={href}>
      <StatusIcon status="open" variant="pr" className="h-3.5 w-3.5 shrink-0" />
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

function EventPreviewDispatcher({ event }: { event: NostrEvent }) {
  if (event.kind === ISSUE_KIND) {
    return <IssuePreviewContent event={event} />;
  }
  if (event.kind === PATCH_KIND) {
    return <PatchPreviewContent event={event} isPR={false} />;
  }
  if (event.kind === PR_KIND) {
    return <PatchPreviewContent event={event} isPR={true} />;
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
      {event ? <EventPreviewDispatcher event={event} /> : <PreviewSkeleton />}
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
      {event ? <EventPreviewDispatcher event={event} /> : <PreviewSkeleton />}
    </PreviewContainer>
  );
}
