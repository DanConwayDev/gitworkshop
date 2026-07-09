import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  CI_RESULT_KIND,
  normalizeCIConclusion,
  type CIResultStatus,
} from "@/lib/ci";
import { CIContextCast } from "./CIContext";

type CIResultEvent = KnownEvent<typeof CI_RESULT_KIND>;

// Cache symbols
const StatusSymbol = Symbol.for("ci-result-status");
const StartedAtSymbol = Symbol.for("ci-result-started-at");
const QueuedAtSymbol = Symbol.for("ci-result-queued-at");

/** Validate that a raw event is a kind:9842 CI workflow result event. */
export function isValidCIResult(event: NostrEvent): event is CIResultEvent {
  return event.kind === CI_RESULT_KIND;
}

/**
 * Cast wrapping a kind:9842 "CI Workflow Result" event — the combined outcome
 * of one workflow run, signed by the coordinator. Individual job results are
 * quoted with NIP-18 `q` tags and parsed by CIContextCast.jobRefs.
 */
export class CIResult extends CIContextCast<CIResultEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCIResult(event)) throw new Error("Invalid CI result event");
    super(event, store);
  }

  /** Workflow conclusion. */
  get status(): CIResultStatus {
    return getOrComputeCachedValue(this.event, StatusSymbol, () =>
      normalizeCIConclusion(getTagValue(this.event, "conclusion")),
    );
  }

  /** Queue timestamp, when provided. */
  get queuedAt(): number | undefined {
    return getOrComputeCachedValue(this.event, QueuedAtSymbol, () => {
      const raw = getTagValue(this.event, "queued_at");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** Execution start timestamp, when provided. */
  get startedAt(): number | undefined {
    return getOrComputeCachedValue(this.event, StartedAtSymbol, () => {
      const raw = getTagValue(this.event, "started_at");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** Optional short human-readable summary. */
  get summary(): string {
    return this.event.content;
  }
}
