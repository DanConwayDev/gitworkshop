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
import { REPO_KIND } from "@/lib/nip34";

type RepositoryEvent = KnownEvent<typeof REPO_KIND>;

// Cache symbols
const NameSymbol = Symbol.for("repo-name");
const DescriptionSymbol = Symbol.for("repo-description");
const DTagSymbol = Symbol.for("repo-d-tag");
const CloneUrlsSymbol = Symbol.for("repo-clone-urls");
const WebUrlsSymbol = Symbol.for("repo-web-urls");
const MaintainersSymbol = Symbol.for("repo-maintainers");
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
    return getOrComputeCachedValue(
      this.event,
      NameSymbol,
      () => getTagValue(this.event, "name") ?? this.dTag,
    );
  }

  get description(): string {
    return getOrComputeCachedValue(
      this.event,
      DescriptionSymbol,
      () => getTagValue(this.event, "description") ?? "",
    );
  }

  get cloneUrls(): string[] {
    return getOrComputeCachedValue(this.event, CloneUrlsSymbol, () =>
      this.event.tags.filter(([t]) => t === "clone").map(([, v]) => v),
    );
  }

  get webUrls(): string[] {
    return getOrComputeCachedValue(this.event, WebUrlsSymbol, () =>
      this.event.tags.filter(([t]) => t === "web").map(([, v]) => v),
    );
  }

  get maintainers(): string[] {
    return getOrComputeCachedValue(this.event, MaintainersSymbol, () => {
      const mTag = this.event.tags.find(([t]) => t === "maintainers");
      return mTag ? mTag.slice(1) : [this.event.pubkey];
    });
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
