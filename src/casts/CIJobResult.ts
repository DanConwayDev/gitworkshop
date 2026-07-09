import type { CastRefEventStore } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue, KnownEvent } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";
import {
  CI_JOB_RESULT_KIND,
  normalizeCIConclusion,
  type CIResultStatus,
} from "@/lib/ci";
import { CIContextCast } from "./CIContext";

type CIJobResultNostrEvent = KnownEvent<typeof CI_JOB_RESULT_KIND>;

// Cache symbols
const JobIdSymbol = Symbol.for("ci-job-result-job-id");
const NameSymbol = Symbol.for("ci-job-result-name");
const StatusSymbol = Symbol.for("ci-job-result-status");
const StartedAtSymbol = Symbol.for("ci-job-result-started-at");
const QueuedAtSymbol = Symbol.for("ci-job-result-queued-at");
const ExitCodeSymbol = Symbol.for("ci-job-result-exit-code");
const LogUrlSymbol = Symbol.for("ci-job-result-log-url");
const RunsOnSymbol = Symbol.for("ci-job-result-runs-on");
const ArtifactUrlsSymbol = Symbol.for("ci-job-result-artifact-urls");

export interface CIArtifactRef {
  url: string;
  filename: string | undefined;
}

/** Validate that a raw event is a kind:9841 CI job result event. */
export function isValidCIJobResult(
  event: NostrEvent,
): event is CIJobResultNostrEvent {
  return event.kind === CI_JOB_RESULT_KIND;
}

/**
 * Cast wrapping a kind:9841 "CI Job Result" event — an independent claim by
 * the compute provider that executed one job. The event `content` carries a
 * small log tail; the full log SHOULD be referenced by a `logs` tag.
 */
export class CIJobResultEvent extends CIContextCast<CIJobResultNostrEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCIJobResult(event)) throw new Error("Invalid CI job event");
    super(event, store);
  }

  /** Job identity from the `job` tag. */
  get jobId(): string {
    return getOrComputeCachedValue(
      this.event,
      JobIdSymbol,
      () => getTagValue(this.event, "job") ?? this.workflowPath ?? "(job)",
    );
  }

  /** Optional human-readable job name. */
  get name(): string | undefined {
    return getOrComputeCachedValue(this.event, NameSymbol, () =>
      getTagValue(this.event, "name"),
    );
  }

  /** Job conclusion. */
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

  /** Execution duration in seconds, derived from started_at and created_at. */
  get duration(): number | undefined {
    if (this.startedAt === undefined) return undefined;
    return this.event.created_at - this.startedAt;
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
    return getOrComputeCachedValue(
      this.event,
      LogUrlSymbol,
      () =>
        getTagValue(this.event, "logs") ?? getTagValue(this.event, "log_url"),
    );
  }

  /** Runner labels from the `runs_on` tag. */
  get runsOn(): string[] {
    return getOrComputeCachedValue(this.event, RunsOnSymbol, () => {
      const tag = this.event.tags.find(([name]) => name === "runs_on");
      return tag ? tag.slice(1).filter(Boolean) : [];
    });
  }

  /** Artifact Blossom URLs and optional filenames. */
  get artifacts(): CIArtifactRef[] {
    return getOrComputeCachedValue(this.event, ArtifactUrlsSymbol, () =>
      this.event.tags
        .filter(([name, url]) => name === "artifact" && !!url)
        .map(([, url, filename]) => ({ url, filename })),
    );
  }

  /** Captured log tail. */
  get log(): string {
    return this.event.content;
  }
}
