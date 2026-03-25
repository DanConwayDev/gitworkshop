import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { PR_KIND, PATCH_CHAIN_TAGS } from "@/lib/nip34";

type PREvent = KnownEvent<typeof PR_KIND>;

// Cache symbols
const SubjectSymbol = Symbol.for("pr-subject");
const LabelsSymbol = Symbol.for("pr-labels");
const RepoCoordSymbol = Symbol.for("pr-repo-coord");
const RepoCoordsSymbol = Symbol.for("pr-repo-coords");
const TipCommitIdSymbol = Symbol.for("pr-tip-commit-id");
const MergeBaseSymbol = Symbol.for("pr-merge-base");

/** Validate that a raw event is a well-formed pull request */
export function isValidPR(event: NostrEvent): event is PREvent {
  return event.kind === PR_KIND;
}

export class PR extends EventCast<PREvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidPR(event)) throw new Error("Invalid PR event");
    super(event, store);
  }

  /** Convenience accessor — same as author.pubkey */
  get pubkey(): string {
    return this.event.pubkey;
  }

  get subject(): string {
    return getOrComputeCachedValue(
      this.event,
      SubjectSymbol,
      () => getTagValue(this.event, "subject") ?? "(untitled)",
    );
  }

  get repoCoord(): string | undefined {
    return getOrComputeCachedValue(this.event, RepoCoordSymbol, () =>
      getTagValue(this.event, "a"),
    );
  }

  /** All repository coordinates from #a tags (a PR may tag multiple repos). */
  get repoCoords(): string[] {
    return getOrComputeCachedValue(this.event, RepoCoordsSymbol, () =>
      this.event.tags.filter(([t]) => t === "a").map(([, v]) => v),
    );
  }

  get body(): string {
    return this.event.content;
  }

  get labels(): string[] {
    return getOrComputeCachedValue(this.event, LabelsSymbol, () =>
      this.event.tags
        .filter(([t, v]) => t === "t" && !PATCH_CHAIN_TAGS.has(v))
        .map(([, v]) => v),
    );
  }

  /**
   * Tip commit ID from the ["c", "<id>"] tag — the head of the PR branch.
   * Returns undefined if the tag is absent.
   */
  get tipCommitId(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      TipCommitIdSymbol,
      () => this.event.tags.find(([t]) => t === "c")?.[1],
    );
  }

  /**
   * Merge-base commit ID from the ["merge-base", "<id>"] tag — the common
   * ancestor with the target branch. Returns undefined if absent.
   */
  get mergeBase(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      MergeBaseSymbol,
      () => this.event.tags.find(([t]) => t === "merge-base")?.[1],
    );
  }
}
