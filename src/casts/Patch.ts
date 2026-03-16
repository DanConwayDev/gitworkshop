import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  PATCH_KIND,
  extractPatchSubject,
  extractPatchBody,
  PATCH_CHAIN_TAGS,
} from "@/lib/nip34";

type PatchEvent = KnownEvent<typeof PATCH_KIND>;

// Cache symbols
const SubjectSymbol = Symbol.for("patch-subject");
const BodySymbol = Symbol.for("patch-body");
const LabelsSymbol = Symbol.for("patch-labels");
const RepoCoordSymbol = Symbol.for("patch-repo-coord");
const RepoCoordsSymbol = Symbol.for("patch-repo-coords");

/** Validate that a raw event is a well-formed patch */
export function isValidPatch(event: NostrEvent): event is PatchEvent {
  return event.kind === PATCH_KIND;
}

export class Patch extends EventCast<PatchEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidPatch(event)) throw new Error("Invalid patch event");
    super(event, store);
  }

  /** Convenience accessor — same as author.pubkey */
  get pubkey(): string {
    return this.event.pubkey;
  }

  get subject(): string {
    return getOrComputeCachedValue(this.event, SubjectSymbol, () =>
      extractPatchSubject(this.event),
    );
  }

  get body(): string {
    return getOrComputeCachedValue(this.event, BodySymbol, () =>
      extractPatchBody(this.event),
    );
  }

  get repoCoord(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      RepoCoordSymbol,
      () => this.event.tags.find(([t]) => t === "a")?.[1],
    );
  }

  /** All repository coordinates from #a tags (a patch may tag multiple repos). */
  get repoCoords(): string[] {
    return getOrComputeCachedValue(this.event, RepoCoordsSymbol, () =>
      this.event.tags.filter(([t]) => t === "a").map(([, v]) => v),
    );
  }

  get content(): string {
    return this.event.content;
  }

  get labels(): string[] {
    return getOrComputeCachedValue(this.event, LabelsSymbol, () =>
      this.event.tags
        .filter(([t, v]) => t === "t" && !PATCH_CHAIN_TAGS.has(v))
        .map(([, v]) => v),
    );
  }

  get isRoot(): boolean {
    return this.event.tags.some(([t, v]) => t === "t" && v === "root");
  }
}
