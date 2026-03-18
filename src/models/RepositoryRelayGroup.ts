import { Observable, Subscription } from "rxjs";
import type { Model } from "applesauce-core/event-store";
import { RelayGroup } from "applesauce-relay";
import { REPO_KIND, getRepoRelays, getRepoMaintainers } from "@/lib/nip34";
import { pool } from "@/services/nostr";

/**
 * RepositoryRelayGroup — a long-lived RelayGroup for a repository, cached by
 * the EventStore model system alongside RepositoryModel.
 *
 * Starts with an empty group and grows as the repository's declared relay list
 * is discovered from announcement events (kind 30617). Callers (e.g.
 * useResolvedRepository) add further relays (maintainer outboxes) via
 * group.add() as NIP-65 data arrives.
 *
 * Because RelayGroup.add() is idempotent (checks has() before next()) and
 * internalSubscription uses a WeakMap cache keyed on the Relay instance,
 * adding a relay that is already in the group is a no-op, and adding a new
 * relay opens a subscription only to that relay — existing subscriptions are
 * untouched.
 *
 * Model cache key: (selectedMaintainer, dTag) — same as RepositoryModel, so
 * the two models share a lifetime and are torn down together.
 */
export function RepositoryRelayGroup(
  selectedMaintainer: string,
  dTag: string,
): Model<RelayGroup> {
  return (store) => {
    const group = new RelayGroup([]);

    return new Observable<RelayGroup>((observer) => {
      const subs = new Subscription();

      // Subscribe to every kind:30617 event for this dTag in the store.
      // store.addressable() re-emits whenever the event changes (new version
      // of a replaceable event). We watch all pubkeys we discover via BFS,
      // mirroring what RepositoryModel does — but here we only care about
      // the relay tags, not the full chain resolution.
      const subscribed = new Set<string>();

      function subscribe(pubkey: string) {
        if (subscribed.has(pubkey)) return;
        subscribed.add(pubkey);

        subs.add(
          store
            .addressable({ kind: REPO_KIND, pubkey, identifier: dTag })
            .subscribe((ev) => {
              if (!ev) return;

              // Add any relay URLs declared in this announcement
              for (const url of getRepoRelays(ev)) {
                const relay = pool.relay(url);
                if (!group.has(relay)) group.add(relay);
              }

              // Follow the maintainers tag to discover co-maintainer relays
              for (const mp of getRepoMaintainers(ev)) {
                subscribe(mp);
              }

              // Emit the group (same instance) so subscribers know it grew
              observer.next(group);
            }),
        );
      }

      subscribe(selectedMaintainer);

      // Emit immediately so consumers get the group reference synchronously
      observer.next(group);

      return () => {
        subs.unsubscribe();
      };
    });
  };
}
