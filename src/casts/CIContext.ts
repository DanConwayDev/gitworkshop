/**
 * Shared base cast for ngit-ci CI events (kinds 9841 / 9842).
 *
 * Both kinds carry the same common CI context tags:
 *   ["a", "30617:<owner>:<repo-id>"]  — repository coordinate. Multi-maintainer
 *                                       repos are announced under one coordinate
 *                                       per maintainer, so CI events may carry
 *                                       multiple `a` tags — one per coordinate.
 *   ["c", "<commit-id>"]              — commit the workflow ran against
 *   ["w", "<workflow-path>"]          — selected workflow file path
 *   ["x", "<trigger>"]                — push | pull_request | manual | schedule
 *   ["runner", ...] / ["platform", ...] — optional runner metadata
 *
 * Trigger context:
 *   push:      ["r", "refs/heads/<branch>"]
 *   PR:        NIP-22-style ["E", <pr-root>] / ["e", <pr-or-update-trigger>]
 */

import { EventCast } from "applesauce-common/casts/cast";
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { getTagValue } from "applesauce-core/helpers/event";
import type { NostrEvent } from "nostr-tools";

// Cache symbols (per-event caches, safe to share across both kinds)
const RepoCoordSymbol = Symbol.for("ci-repo-coord");
const RepoCoordsSymbol = Symbol.for("ci-repo-coords");
const CommitIdSymbol = Symbol.for("ci-commit-id");
const WorkflowPathSymbol = Symbol.for("ci-workflow-path");
const TriggerSymbol = Symbol.for("ci-trigger");
const RunnerSymbol = Symbol.for("ci-runner");
const PlatformSymbol = Symbol.for("ci-platform");
const BranchRefSymbol = Symbol.for("ci-branch-ref");
const PRRootIdSymbol = Symbol.for("ci-pr-root-id");
const TriggerEventIdSymbol = Symbol.for("ci-trigger-event-id");

export abstract class CIContextCast<
  T extends NostrEvent = NostrEvent,
> extends EventCast<T> {
  /** Convenience accessor — the runner / coordinator identity. */
  get pubkey(): string {
    return this.event.pubkey;
  }

  /** First repository coordinate from the `a` tags (30617:<owner>:<repo-id>). */
  get repoCoord(): string | undefined {
    return getOrComputeCachedValue(this.event, RepoCoordSymbol, () =>
      getTagValue(this.event, "a"),
    );
  }

  /**
   * All repository coordinates from `a` tags. Multi-maintainer repos are
   * announced under one coordinate per maintainer, and CI events may tag
   * all of them.
   */
  get repoCoords(): string[] {
    return getOrComputeCachedValue(this.event, RepoCoordsSymbol, () =>
      this.event.tags.filter(([t, v]) => t === "a" && !!v).map(([, v]) => v),
    );
  }

  /** Commit the workflow ran against (`c` tag). */
  get commitId(): string | undefined {
    return getOrComputeCachedValue(this.event, CommitIdSymbol, () =>
      getTagValue(this.event, "c"),
    );
  }

  /** Selected workflow file path (`w` tag). */
  get workflowPath(): string | undefined {
    return getOrComputeCachedValue(this.event, WorkflowPathSymbol, () =>
      getTagValue(this.event, "w"),
    );
  }

  /** Normalized trigger name (`x` tag). */
  get trigger(): string | undefined {
    return getOrComputeCachedValue(this.event, TriggerSymbol, () =>
      getTagValue(this.event, "x"),
    );
  }

  /** Optional runner name. */
  get runner(): string | undefined {
    return getOrComputeCachedValue(this.event, RunnerSymbol, () =>
      getTagValue(this.event, "runner"),
    );
  }

  /** Optional CI platform (github-actions | forgejo-actions | gitlab-ci). */
  get platform(): string | undefined {
    return getOrComputeCachedValue(this.event, PlatformSymbol, () =>
      getTagValue(this.event, "platform"),
    );
  }

  /** Push trigger branch ref (`r` tag, e.g. refs/heads/main). */
  get branchRef(): string | undefined {
    return getOrComputeCachedValue(this.event, BranchRefSymbol, () =>
      getTagValue(this.event, "r"),
    );
  }

  /** Root PR event id (`E` tag) for PR-triggered workflows. */
  get prRootId(): string | undefined {
    return getOrComputeCachedValue(this.event, PRRootIdSymbol, () =>
      getTagValue(this.event, "E"),
    );
  }

  /**
   * The concrete trigger event id (`e` tag) — the PR root or a PR Update
   * (kind:1619) event for PR-triggered workflows.
   */
  get triggerEventId(): string | undefined {
    return getOrComputeCachedValue(this.event, TriggerEventIdSymbol, () =>
      getTagValue(this.event, "e"),
    );
  }
}
