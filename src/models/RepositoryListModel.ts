import { map } from "rxjs/operators";
import type { Model } from "applesauce-core/event-store";
import {
  REPO_KIND,
  groupIntoResolvedRepos,
  type ResolvedRepo,
} from "@/lib/nip34";
import type { Filter } from "applesauce-core/helpers";

const repoFilter: Filter[] = [{ kinds: [REPO_KIND] }];

/**
 * RepositoryListModel — subscribes to all 30617 events in the store and
 * emits a deduplicated list of resolved repositories.
 *
 * Multi-maintainer repos (where pubkeys mutually list each other) are merged
 * into a single ResolvedRepo. The trustedMaintainer field on each result is
 * set to a randomly-selected pubkey from the connected component (to be
 * refined later, e.g. prefer followed users).
 *
 * This model does NOT fetch from relays — pair it with a relay fetch in the
 * hook layer (useRepositoryList) that populates the store first.
 *
 * Model cache key: no args — one instance shared across all subscribers.
 */
export function RepositoryListModel(): Model<ResolvedRepo[]> {
  return (store) =>
    store
      .timeline(repoFilter)
      .pipe(map((events) => groupIntoResolvedRepos(events)));
}
