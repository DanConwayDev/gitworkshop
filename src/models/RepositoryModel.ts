import { Observable, Subscription } from "rxjs";
import type { Model } from "applesauce-core/event-store";
import { REPO_KIND, resolveChain, type ResolvedRepo } from "@/lib/nip34";
import type { NostrEvent } from "nostr-tools";

/**
 * RepositoryModel — reactively resolves the full maintainer chain for a
 * single repository starting from a selected maintainer pubkey + d-tag.
 *
 * How it works:
 * 1. Subscribe to the selected maintainer's announcement via store.addressable()
 * 2. Read the maintainers tag and subscribe to each listed pubkey's announcement
 * 3. For each of those, read their maintainers tags and subscribe further
 * 4. Repeat until no new pubkeys are discovered (fixed point)
 * 5. Re-emit a ResolvedRepo whenever any announcement in the chain changes
 *
 * The EventStore's eventLoader (wired to addressLoader in nostr.ts) will
 * automatically fetch any co-maintainer announcements that aren't in the
 * store yet when we subscribe to them via store.addressable().
 *
 * Model cache key: (selectedMaintainer, dTag) — one instance per repo page.
 */
export function RepositoryModel(
  selectedMaintainer: string,
  dTag: string,
): Model<ResolvedRepo | undefined> {
  return (store) =>
    new Observable<ResolvedRepo | undefined>((observer) => {
      // Track which pubkeys we're currently subscribed to
      const subscribed = new Set<string>();
      // All inner subscriptions — collected so the teardown can unsubscribe them
      const subs = new Subscription();
      // Latest announcement event per pubkey
      const latestByPubkey = new Map<string, NostrEvent | undefined>();

      // Emit a resolved repo from the current snapshot
      function emit() {
        const events = Array.from(latestByPubkey.values()).filter(
          (ev): ev is NostrEvent => ev !== undefined,
        );
        observer.next(resolveChain(events, selectedMaintainer, dTag));
      }

      // Subscribe to a pubkey's announcement and recursively subscribe to
      // any newly-discovered maintainers
      function subscribe(pubkey: string) {
        if (subscribed.has(pubkey)) return;
        subscribed.add(pubkey);

        subs.add(
          store
            .addressable({ kind: REPO_KIND, pubkey, identifier: dTag })
            .subscribe((ev) => {
              const prev = latestByPubkey.get(pubkey);
              latestByPubkey.set(pubkey, ev ?? undefined);

              if (ev) {
                // Read maintainers tag and subscribe to any new pubkeys
                const maintainersTag = ev.tags.find(
                  ([t]) => t === "maintainers",
                );
                const listed = maintainersTag ? maintainersTag.slice(1) : [];
                let newDiscoveries = false;
                for (const mp of listed) {
                  if (!subscribed.has(mp)) {
                    newDiscoveries = true;
                    subscribe(mp);
                  }
                }
                // Only emit immediately if no new subscriptions were opened
                // (they will each trigger their own emit on first value)
                if (!newDiscoveries || prev !== undefined) emit();
              } else {
                // Announcement removed or not found
                if (prev !== undefined) emit();
              }
            }),
        );
      }

      // Start from the selected maintainer
      subscribe(selectedMaintainer);

      return () => {
        // Unsubscribe all inner store.addressable() subscriptions collected
        // in `subs`. Without this they would leak on component unmount.
        subs.unsubscribe();
      };
    });
}
