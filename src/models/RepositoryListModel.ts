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
 * into a single ResolvedRepo.
 *
 * @param trustedMaintainer - If provided, only resolve repos where this pubkey
 *   has an announcement, using them as the BFS starting point. Each result's
 *   trustedMaintainer will be this pubkey. When omitted, all connected
 *   components are resolved with an arbitrary starting pubkey.
 *
 * This model does NOT fetch from relays — pair it with a relay fetch in the
 * hook layer (useRepositoryList / useUserRepositories) that populates the
 * store first.
 *
 * Model cache key: (trustedMaintainer) — one shared instance per pubkey
 * (or one global instance when called with no args).
 */
export function RepositoryListModel(
  trustedMaintainer?: string,
): Model<ResolvedRepo[]> {
  return (store) =>
    store
      .timeline(repoFilter)
      .pipe(map((events) => groupIntoResolvedRepos(events, trustedMaintainer)));
}
