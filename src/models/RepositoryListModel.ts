import { map, debounceTime } from "rxjs/operators";
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
 * into a single ResolvedRepo.
 *
 * @param forPubkey - If provided, only return repos where this pubkey is
 *   involved — either as the event author or listed in a `maintainers` tag.
 *   When omitted, all connected components are resolved.
 *
 * This model does NOT fetch from relays — pair it with a relay fetch in the
 * hook layer (useAllRepositories / useUserRepositories) that populates the
 * store first.
 *
 * Model cache key: (forPubkey) — one shared instance per pubkey
 * (or one global instance when called with no args).
 *
 * debounceTime(150) prevents groupIntoResolvedRepos (O(n²)) from running on
 * every individual event during bulk-fetch (NIP-77 sync / pagination walk),
 * which would otherwise cause thousands of expensive recomputations.
 */
export function RepositoryListModel(forPubkey?: string): Model<ResolvedRepo[]> {
  return (store) =>
    store.timeline(repoFilter).pipe(
      debounceTime(150),
      map((events) => groupIntoResolvedRepos(events, forPubkey)),
    );
}
