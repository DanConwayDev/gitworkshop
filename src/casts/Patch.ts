import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import {
  getOrComputeCachedValue,
  hasNameValueTag,
} from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  PATCH_KIND,
  extractPatchSubject,
  extractPatchBody,
  extractPatchDiff,
  PATCH_CHAIN_TAGS,
} from "@/lib/nip34";

type PatchEvent = KnownEvent<typeof PATCH_KIND>;

// Cache symbols
const SubjectSymbol = Symbol.for("patch-subject");
const BodySymbol = Symbol.for("patch-body");
const PatchDiffSymbol = Symbol.for("patch-diff");
const IsRootSymbol = Symbol.for("patch-is-root");
const IsRootRevisionSymbol = Symbol.for("patch-is-root-revision");
const LabelsSymbol = Symbol.for("patch-labels");
const RepoCoordSymbol = Symbol.for("patch-repo-coord");
const RepoCoordsSymbol = Symbol.for("patch-repo-coords");
const CommitIdSymbol = Symbol.for("patch-commit-id");
const ParentCommitIdSymbol = Symbol.for("patch-parent-commit-id");
const ReplyToIdSymbol = Symbol.for("patch-reply-to-id");

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

  /** The unified diff extracted from the patch content. Empty string if absent. */
  get patchDiff(): string {
    return getOrComputeCachedValue(this.event, PatchDiffSymbol, () =>
      extractPatchDiff(this.event.content),
    );
  }

  get repoCoord(): string | undefined {
    return getOrComputeCachedValue(this.event, RepoCoordSymbol, () =>
      getTagValue(this.event, "a"),
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
    return getOrComputeCachedValue(this.event, IsRootSymbol, () =>
      hasNameValueTag(this.event, "t", "root"),
    );
  }

  /**
   * True when this patch is the first patch in a new revision of an existing
   * patch set. NIP-34: `["t", "root-revision"]` tag.
   *
   * Note: older ngit versions (< 1.8) incorrectly used `"revision-root"` —
   * we check both for compatibility.
   */
  get isRootRevision(): boolean {
    return getOrComputeCachedValue(
      this.event,
      IsRootRevisionSymbol,
      () =>
        hasNameValueTag(this.event, "t", "root-revision") ||
        hasNameValueTag(this.event, "t", "revision-root"),
    );
  }

  /**
   * The commit ID this patch produces, from the `["commit", "<id>"]` tag.
   * Returns undefined if the tag is absent (not all patches include it).
   */
  get commitId(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      CommitIdSymbol,
      () => this.event.tags.find(([t]) => t === "commit")?.[1],
    );
  }

  /**
   * The parent commit ID, from the `["parent-commit", "<id>"]` tag.
   * Returns undefined if the tag is absent.
   */
  get parentCommitId(): string | undefined {
    return getOrComputeCachedValue(
      this.event,
      ParentCommitIdSymbol,
      () => this.event.tags.find(([t]) => t === "parent-commit")?.[1],
    );
  }

  /**
   * The event ID this patch replies to, from the NIP-10 `["e", "<id>", "", "reply"]` tag.
   * Returns undefined if absent (root patches have no reply tag).
   */
  get replyToId(): string | undefined {
    return getOrComputeCachedValue(this.event, ReplyToIdSymbol, () => {
      // NIP-10: prefer tagged reply marker
      const replyTag = this.event.tags.find(
        ([t, , , marker]) => t === "e" && marker === "reply",
      );
      if (replyTag) return replyTag[1];
      // Fallback: any e tag (for patches that don't use markers)
      return this.event.tags.find(([t]) => t === "e")?.[1];
    });
  }
}
