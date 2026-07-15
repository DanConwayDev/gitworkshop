/**
 * MentionedNip34Items — related items and comments that quote an item.
 *
 * Detail-page thread loading already retrieves every event with a `q` tag for
 * the current item. Events that belong to another discussion are not replies,
 * though: they merely reference this one.
 * Render them separately so they are discoverable without being mistaken for
 * part of the current conversation.
 */
import { Quote } from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import type { Filter } from "applesauce-core/helpers";
import { map } from "rxjs/operators";
import {
  EmbeddedEventByIdPreview,
  EmbeddedEventPreview,
} from "@/components/EmbeddedEventPreview";
import { use$ } from "@/hooks/use$";
import { useEventStore } from "@/hooks/useEventStore";
import {
  COMMENT_KIND,
  ISSUE_KIND,
  LEGACY_REPLY_KINDS,
  PR_ROOT_KINDS,
} from "@/lib/nip34";

interface MentionedNip34ItemsProps {
  /** ID of the issue, PR, or patch being viewed. */
  rootId: string;
}

function isDirectReplyTo(event: NostrEvent, rootId: string): boolean {
  return event.tags.some(
    ([name, id, , marker]) =>
      (name === "E" && id === rootId) ||
      (name === "e" &&
        id === rootId &&
        (marker === "root" || marker === "reply" || marker === undefined)),
  );
}

function getCommentRootId(event: NostrEvent): string | undefined {
  return event.tags.find(
    ([name, , , marker]) => name === "E" || (name === "e" && marker === "root"),
  )?.[1];
}

function isComment(event: NostrEvent): boolean {
  return (
    event.kind === COMMENT_KIND ||
    LEGACY_REPLY_KINDS.includes(
      event.kind as (typeof LEGACY_REPLY_KINDS)[number],
    )
  );
}

function MentionedItem({ event }: { event: NostrEvent }) {
  const commentRootId = isComment(event) ? getCommentRootId(event) : undefined;

  if (!commentRootId) {
    return (
      <EmbeddedEventPreview event={event} className="my-0 bg-background/70" />
    );
  }

  return (
    <div className="space-y-1.5">
      <EmbeddedEventByIdPreview
        pointer={{ id: commentRootId }}
        className="my-0 bg-background/70"
      />
      <div className="ml-3 border-l border-primary/30 pl-2">
        <EmbeddedEventPreview event={event} className="my-0 bg-background/70" />
      </div>
    </div>
  );
}

export function MentionedNip34Items({ rootId }: MentionedNip34ItemsProps) {
  const store = useEventStore();

  const mentionedItems = use$(() => {
    return store
      .timeline([
        {
          kinds: [
            ISSUE_KIND,
            ...PR_ROOT_KINDS,
            COMMENT_KIND,
            ...LEGACY_REPLY_KINDS,
          ],
          "#q": [rootId],
        } as Filter,
      ])
      .pipe(
        map((events) =>
          (events as NostrEvent[])
            .filter((event) => {
              if (event.id === rootId || isDirectReplyTo(event, rootId)) {
                return false;
              }
              // A quote is related context, not repository state. Its author
              // and repository may legitimately differ from the current item;
              // each linked item's detail page validates its own authority.
              return true;
            })
            .sort(
              (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
            ),
        ),
      );
  }, [rootId, store]);

  if (!mentionedItems || mentionedItems.length === 0) return null;

  return (
    <section
      aria-label="Related discussions that mention this item"
      className="rounded-lg border border-dashed border-primary/35 bg-primary/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-2 text-sm">
        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h2 className="font-medium text-foreground">Mentioned in</h2>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {mentionedItems.map((event) => (
          <MentionedItem key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}
