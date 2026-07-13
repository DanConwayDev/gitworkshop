import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  CI_RUN_KIND,
  normalizeCIConclusion,
  type CIResultStatus,
} from "@/lib/ci";
import { CIContextCast } from "./CIContext";

type CIRunEvent = KnownEvent<typeof CI_RUN_KIND>;

// Cache symbols
const ExpirationSymbol = Symbol.for("ci-run-expiration");
const RunIdSymbol = Symbol.for("ci-run-id");
const ProgressStatusSymbol = Symbol.for("ci-run-status");
const QueueRoundsSymbol = Symbol.for("ci-run-queue-rounds");
const QueuedAtSymbol = Symbol.for("ci-run-queued-at");
const StartedAtSymbol = Symbol.for("ci-run-started-at");
const InProgressJobsSymbol = Symbol.for("ci-run-in-progress-jobs");
const ConclusionSymbol = Symbol.for("ci-run-conclusion");

export type CIProgressStatus = "queued" | "in_progress" | "concluded";

/** Validate that a raw event is a kind:39842 CI workflow progress event. */
export function isValidCIRun(event: NostrEvent): event is CIRunEvent {
  return event.kind === CI_RUN_KIND;
}

/**
 * Cast wrapping a kind:39842 "CI Workflow Progress" event — a temporary,
 * addressable progress marker published while a workflow is queued, running,
 * or recently concluded. Carries a NIP-40 expiration so stale markers clear
 * themselves if the coordinator crashes before publishing a result.
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

  /** Addressable run attempt identifier (`d` tag). */
  get runId(): string | undefined {
    return getOrComputeCachedValue(this.event, RunIdSymbol, () =>
      getTagValue(this.event, "d"),
    );
  }

  /** Progress status: queued, in_progress, or concluded. */
  get progressStatus(): CIProgressStatus | undefined {
    return getOrComputeCachedValue(this.event, ProgressStatusSymbol, () => {
      const raw = getTagValue(this.event, "status");
      if (raw === "queued" || raw === "in_progress" || raw === "concluded") {
        return raw;
      }
      return undefined;
    });
  }

  /** Whether this marker represents active queued/running work. */
  get isPending(): boolean {
    return (
      this.progressStatus === "queued" || this.progressStatus === "in_progress"
    );
  }

  /** Optional queue estimate in capacity rounds. */
  get queueRounds(): number | undefined {
    return getOrComputeCachedValue(this.event, QueueRoundsSymbol, () => {
      const raw = getTagValue(this.event, "queue");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** Timestamp at which this workflow entered the coordinator queue. */
  get queuedAt(): number | undefined {
    return getOrComputeCachedValue(this.event, QueuedAtSymbol, () => {
      const raw = getTagValue(this.event, "queued_at");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** Timestamp at which this workflow began execution. */
  get startedAt(): number | undefined {
    return getOrComputeCachedValue(this.event, StartedAtSymbol, () => {
      const raw = getTagValue(this.event, "started_at");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** Job ids currently executing according to `in-progress` tags. */
  get inProgressJobs(): string[] {
    return getOrComputeCachedValue(this.event, InProgressJobsSymbol, () =>
      this.event.tags
        .filter(([name, jobId]) => name === "in-progress" && !!jobId)
        .flatMap(([, ...jobIds]) => jobIds.filter(Boolean)),
    );
  }

  /** Conclusion tag present only when progress status is concluded. */
  get conclusion(): CIResultStatus | undefined {
    return getOrComputeCachedValue(this.event, ConclusionSymbol, () => {
      const raw = getTagValue(this.event, "conclusion");
      return raw ? normalizeCIConclusion(raw) : undefined;
    });
  }
}
