import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  CI_RESULT_KIND,
  normalizeCIStatus,
  type CIResultStatus,
} from "@/lib/ci";
import { CIContextCast } from "./CIContext";

type CIResultEvent = KnownEvent<typeof CI_RESULT_KIND>;

// Cache symbols
const JobIdSymbol = Symbol.for("ci-result-job-id");
const StatusSymbol = Symbol.for("ci-result-status");
const DurationSymbol = Symbol.for("ci-result-duration");
const ExitCodeSymbol = Symbol.for("ci-result-exit-code");
const LogUrlSymbol = Symbol.for("ci-result-log-url");
const StageSymbol = Symbol.for("ci-result-stage");

/** Validate that a raw event is a kind:9842 CI workflow result event. */
export function isValidCIResult(event: NostrEvent): event is CIResultEvent {
  return event.kind === CI_RESULT_KIND;
}

/**
 * Cast wrapping a kind:9842 "CI Workflow Result" event — an independent
 * attestation of a workflow / job outcome signed by the runner identity.
 * The event `content` carries the captured log output (or a truncated tail).
 */
export class CIResult extends CIContextCast<CIResultEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCIResult(event)) throw new Error("Invalid CI result event");
    super(event, store);
  }

  /**
   * Job identity from the `job` tag. Backends that only report a
   * workflow-level result use the workflow path, so fall back to it.
   */
  get jobId(): string {
    return getOrComputeCachedValue(
      this.event,
      JobIdSymbol,
      () => getTagValue(this.event, "job") ?? this.workflowPath ?? "(workflow)",
    );
  }

  /** Result status — unknown values are normalized to "error". */
  get status(): CIResultStatus {
    return getOrComputeCachedValue(this.event, StatusSymbol, () =>
      normalizeCIStatus(getTagValue(this.event, "status")),
    );
  }

  /**
   * Execution duration in seconds. Prefers the `duration` tag, falls back
   * to the higher-precision `duration_ms` compatibility tag.
   */
  get duration(): number | undefined {
    return getOrComputeCachedValue(this.event, DurationSymbol, () => {
      const secs = getTagValue(this.event, "duration");
      if (secs !== undefined) {
        const n = Number.parseFloat(secs);
        if (Number.isFinite(n)) return n;
      }
      const ms = getTagValue(this.event, "duration_ms");
      if (ms !== undefined) {
        const n = Number.parseFloat(ms);
        if (Number.isFinite(n)) return n / 1000;
      }
      return undefined;
    });
  }

  /** Process exit code, when available. */
  get exitCode(): number | undefined {
    return getOrComputeCachedValue(this.event, ExitCodeSymbol, () => {
      const raw = getTagValue(this.event, "exit_code");
      if (raw === undefined) return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  /** External full log location, when the log is stored elsewhere. */
  get logUrl(): string | undefined {
    return getOrComputeCachedValue(this.event, LogUrlSymbol, () =>
      getTagValue(this.event, "log_url"),
    );
  }

  /** Stage name for backends that expose stages. */
  get stage(): string | undefined {
    return getOrComputeCachedValue(this.event, StageSymbol, () =>
      getTagValue(this.event, "stage"),
    );
  }

  /** Captured log output (or truncated tail / summary). */
  get log(): string {
    return this.event.content;
  }
}
