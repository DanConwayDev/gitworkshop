import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import {
  getAddressPointerForEvent,
  addRelayHintsToPointer,
  naddrEncode,
} from "applesauce-core/helpers/pointers";
import { withImmediateValueOrDefault } from "applesauce-core/observable/with-immediate-value";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { map } from "rxjs";
import {
  REPO_KIND,
  getRepoName,
  getRepoDescription,
  getRepoCloneUrls,
  getRepoWebUrls,
  getRepoMaintainers,
} from "@/lib/nip34";

type RepositoryEvent = KnownEvent<typeof REPO_KIND>;

// Cache symbols for cast-specific computed values not covered by nip34 extractors
const DTagSymbol = Symbol.for("repo-d-tag");
const LabelsSymbol = Symbol.for("repo-labels");

/** Validate that a raw event is a well-formed repository announcement */
export function isValidRepository(event: NostrEvent): event is RepositoryEvent {
  return event.kind === REPO_KIND && !!getTagValue(event, "d");
}

export class Repository extends EventCast<RepositoryEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRepository(event)) throw new Error("Invalid repository event");
    super(event, store);
  }

  /** Convenience accessor — same as author.pubkey */
  get pubkey(): string {
    return this.event.pubkey;
  }

  get dTag(): string {
    return getOrComputeCachedValue(
      this.event,
      DTagSymbol,
      () => getTagValue(this.event, "d")!,
    );
  }

  get name(): string {
    return getRepoName(this.event) || this.dTag;
  }

  get description(): string {
    return getRepoDescription(this.event);
  }

  get cloneUrls(): string[] {
    return getRepoCloneUrls(this.event);
  }

  get webUrls(): string[] {
    return getRepoWebUrls(this.event);
  }

  get maintainers(): string[] {
    const listed = getRepoMaintainers(this.event);
    return listed.length > 0 ? listed : [this.event.pubkey];
  }

  get labels(): string[] {
    return getOrComputeCachedValue(this.event, LabelsSymbol, () =>
      this.event.tags
        .filter(([t]) => t === "t")
        .map(([, v]) => v)
        .filter((v) => v !== "personal-fork"),
    );
  }

  /** NIP-19 address pointer for this addressable event */
  get pointer() {
    return getAddressPointerForEvent(this.event)!;
  }

  /** Observable pointer with relay hints from the author's outboxes */
  get pointer$() {
    return this.author.outboxes$.pipe(
      withImmediateValueOrDefault(undefined),
      map((outboxes) =>
        outboxes
          ? addRelayHintsToPointer(this.pointer, outboxes.slice(0, 3))
          : this.pointer,
      ),
    );
  }

  /** naddr-encoded address string */
  get address(): string {
    return naddrEncode(this.pointer);
  }

  /** Observable naddr string with relay hints */
  get address$() {
    return this.pointer$.pipe(map((pointer) => naddrEncode(pointer)));
  }
}
