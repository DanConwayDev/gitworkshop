import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  REPO_STATE_KIND,
  getStateRefs,
  getStateHead,
  getStateHeadCommit,
  type RepoStateRef,
} from "@/lib/nip34";

type RepositoryStateEvent = KnownEvent<typeof REPO_STATE_KIND>;

// Cache symbols
const DTagSymbol = Symbol.for("repo-state-d-tag");

/** Validate that a raw event is a well-formed repository state announcement */
export function isValidRepositoryState(
  event: NostrEvent,
): event is RepositoryStateEvent {
  return event.kind === REPO_STATE_KIND && !!getTagValue(event, "d");
}

/**
 * Cast wrapping a kind:30618 repository state announcement.
 *
 * The "winning" state event for a repository is the one with the highest
 * `created_at` among all maintainers (with event ID as tiebreaker).
 * This selection is done in `useRepositoryState` — this class simply
 * provides typed access to a single state event's data.
 */
export class RepositoryState extends EventCast<RepositoryStateEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidRepositoryState(event))
      throw new Error("Invalid repository state event");
    super(event, store);
  }

  /** The d-tag — matches the corresponding repository announcement's d-tag */
  get dTag(): string {
    return getOrComputeCachedValue(
      this.event,
      DTagSymbol,
      () => getTagValue(this.event, "d")!,
    );
  }

  /** All refs declared in this state event */
  get refs(): RepoStateRef[] {
    return getStateRefs(this.event);
  }

  /**
   * The HEAD ref path (e.g. "refs/heads/main"), or undefined if not declared.
   */
  get headRef(): string | undefined {
    return getStateHead(this.event);
  }

  /**
   * The commit ID that HEAD points to, or undefined if HEAD or the target ref
   * is missing.
   */
  get headCommitId(): string | undefined {
    return getStateHeadCommit(this.event);
  }

  /**
   * The branch name that HEAD points to (e.g. "main"), derived from the HEAD
   * ref path. Returns undefined when HEAD is not declared.
   */
  get headBranch(): string | undefined {
    const ref = this.headRef;
    if (!ref) return undefined;
    // "refs/heads/main" → "main"
    return ref.replace(/^refs\/heads\//, "");
  }

  /** Whether this state event has any refs (false means the author stopped tracking) */
  get hasRefs(): boolean {
    return this.refs.length > 0;
  }

  /** Pubkey of the maintainer who published this state event */
  get publisherPubkey(): string {
    return this.event.pubkey;
  }
}
