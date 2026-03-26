import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { PR_UPDATE_KIND } from "@/lib/nip34";

type PRUpdateEvent = KnownEvent<typeof PR_UPDATE_KIND>;

// Cache symbols
const TipCommitIdSymbol = Symbol.for("pr-update-tip-commit-id");
const MergeBaseSymbol = Symbol.for("pr-update-merge-base");
const CloneUrlsSymbol = Symbol.for("pr-update-clone-urls");
const RootIdSymbol = Symbol.for("pr-update-root-id");

/** Validate that a raw event is a well-formed PR Update */
export function isValidPRUpdate(event: NostrEvent): event is PRUpdateEvent {
  return event.kind === PR_UPDATE_KIND;
}

/**
 * Cast for kind:1619 Pull Request Update events.
 *
 * A PR Update changes the tip commit of a referenced PR (kind:1618). It
 * carries the new tip commit ID, optional merge-base, and clone URLs.
 */
export class PRUpdate extends EventCast<PRUpdateEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidPRUpdate(event)) throw new Error("Invalid PR Update event");
    super(event, store);
  }

  /** Convenience accessor */
  get pubkey(): string {
    return this.event.pubkey;
  }

  /**
   * The event ID of the PR this update belongs to, from the NIP-22
   * uppercase `["E", "<pr-event-id>"]` tag.
   */
  get rootId(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      RootIdSymbol,
      () => this.event.tags.find(([t]) => t === "E")?.[1],
    );
  }

  /**
   * Updated tip commit ID from the `["c", "<id>"]` tag.
   */
  get tipCommitId(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      TipCommitIdSymbol,
      () => this.event.tags.find(([t]) => t === "c")?.[1],
    );
  }

  /**
   * Optional merge-base commit ID from the `["merge-base", "<id>"]` tag.
   */
  get mergeBase(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      MergeBaseSymbol,
      () => this.event.tags.find(([t]) => t === "merge-base")?.[1],
    );
  }

  /**
   * Clone URLs from `["clone", "<url>", ...]` tags.
   */
  get cloneUrls(): string[] {
    return getOrComputeCachedValue(this.event, CloneUrlsSymbol, () =>
      this.event.tags
        .filter(([t]) => t === "clone")
        .flatMap(([, ...urls]) => urls.filter(Boolean)),
    );
  }
}
