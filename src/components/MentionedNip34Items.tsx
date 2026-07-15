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
import { EmbeddedEventPreview } from "@/components/EmbeddedEventPreview";
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
  /** All coordinates for the resolved repository. */
  repoCoords: string[];
  /** Effective maintainer set used to authenticate root items. */
  maintainers: Set<string> | undefined;
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

export function MentionedNip34Items({
  rootId,
  repoCoords,
  maintainers,
}: MentionedNip34ItemsProps) {
  const store = useEventStore();
  const repoCoordsKey = repoCoords.join(",");
  const maintainersKey = maintainers
    ? [...maintainers].sort().join(",")
    : undefined;

  const mentionedItems = use$(() => {
    // Do not surface root items until their authors can be checked against the
    // repository maintainer set. Nostr root events are otherwise untrusted.
    if (!maintainers || repoCoords.length === 0) return undefined;

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

              const isRootItem =
                event.kind === ISSUE_KIND ||
                PR_ROOT_KINDS.includes(
                  event.kind as (typeof PR_ROOT_KINDS)[number],
                );
              if (!isRootItem) return true;

              // Root items affect repository state, so only show a root item
              // from a confirmed maintainer and this same repository.
              return (
                maintainers.has(event.pubkey) &&
                event.tags.some(
                  ([name, coord]) => name === "a" && repoCoords.includes(coord),
                )
              );
            })
            .sort(
              (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
            ),
        ),
      );
  }, [rootId, repoCoordsKey, maintainersKey, store]);

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
          <p className="text-xs text-muted-foreground">
            Related discussions that reference this item. They are not replies
            in this conversation.
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {mentionedItems.map((event) => (
          <EmbeddedEventPreview
            key={event.id}
            event={event}
            className="my-0 bg-background/70"
          />
        ))}
      </div>
    </section>
  );
}
