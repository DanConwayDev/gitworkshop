import { CastRefEventStore, EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { extractSubject, ISSUE_KIND } from "@/lib/nip34";

type IssueEvent = KnownEvent<typeof ISSUE_KIND>;

// Cache symbols
const SubjectSymbol = Symbol.for("issue-subject");
const LabelsSymbol = Symbol.for("issue-labels");
const RepoCoordSymbol = Symbol.for("issue-repo-coord");
const RepoCoordsSymbol = Symbol.for("issue-repo-coords");

/** Validate that a raw event is a well-formed issue */
export function isValidIssue(event: NostrEvent): event is IssueEvent {
  return event.kind === ISSUE_KIND;
}

export class Issue extends EventCast<IssueEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidIssue(event)) throw new Error("Invalid issue event");
    super(event, store);
  }

  /** Convenience accessor — same as author.pubkey */
  get pubkey(): string {
    return this.event.pubkey;
  }

  get subject(): string {
    return getOrComputeCachedValue(this.event, SubjectSymbol, () =>
      extractSubject(this.event),
    );
  }

  get repoCoord(): string | undefined {
    return getOrComputeCachedValue(this.event, RepoCoordSymbol, () =>
      getTagValue(this.event, "a"),
    );
  }

  /** All repository coordinates from #a tags (an issue may tag multiple repos). */
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
      this.event.tags.filter(([t]) => t === "t").map(([, v]) => v),
    );
  }
}
