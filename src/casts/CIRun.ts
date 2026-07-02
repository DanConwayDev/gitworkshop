import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import { CI_RUN_KIND } from "@/lib/ci";
import { CIContextCast } from "./CIContext";

type CIRunEvent = KnownEvent<typeof CI_RUN_KIND>;

// Cache symbols
const ExpirationSymbol = Symbol.for("ci-run-expiration");

/** Validate that a raw event is a kind:9841 CI workflow started event. */
export function isValidCIRun(event: NostrEvent): event is CIRunEvent {
  return event.kind === CI_RUN_KIND;
}

/**
 * Cast wrapping a kind:9841 "CI Workflow Started" event — a temporary
 * running indicator published when a runner selects and starts a workflow.
 * Carries a NIP-40 expiration so stale markers clear themselves if the
 * coordinator crashes before publishing a result.
 */
export class CIRun extends CIContextCast<CIRunEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCIRun(event)) throw new Error("Invalid CI run event");
    super(event, store);
  }

  /** NIP-40 expiration (unix seconds), or undefined when absent. */
  get expiration(): number | undefined {
    return getOrComputeCachedValue(this.event, ExpirationSymbol, () => {
      const raw = getTagValue(this.event, "expiration");
      if (!raw) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }
}
