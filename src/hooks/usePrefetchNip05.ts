import { useEffect } from "react";
import { Subscription } from "rxjs";
import { castUser } from "applesauce-common/casts";
import { eventStore } from "@/services/nostr";
import { dnsIdentityLoader } from "@/services/nostr";
import { standardizeNip05 } from "@/lib/routeUtils";

/**
 * Prefetch NIP-05 identities for a list of pubkeys.
 *
 * For each pubkey, subscribes to the profile reactively via the User cast.
 * Once a profile arrives with a nip05 field, the identity is requested from
 * the DnsIdentityLoader and persisted to IndexedDB. Subsequent lookups (e.g.
 * in useRepoPath) will hit the IDB cache synchronously.
 *
 * This is fire-and-forget — no state is returned.
 *
 * @param pubkeys - Array of hex pubkeys to prefetch
 */
export function usePrefetchNip05(pubkeys: string[]): void {
  const pubkeyKey = pubkeys.join(",");

  useEffect(() => {
    if (pubkeys.length === 0) return;

    const subscriptions: Subscription[] = [];

    for (const pubkey of pubkeys) {
      if (!pubkey) continue;

      const user = castUser(pubkey, eventStore);

      const sub = user.profile$.subscribe((profile) => {
        const nip05 = profile?.dnsIdentity ?? profile?.metadata?.nip05;
        if (!nip05) return;
        const standardized = standardizeNip05(nip05);
        const atIdx = standardized.indexOf("@");
        if (atIdx === -1) return;
        const name = standardized.slice(0, atIdx);
        const domain = standardized.slice(atIdx + 1);
        // requestIdentity deduplicates in-flight requests, so repeated calls are free
        dnsIdentityLoader.requestIdentity(name, domain).catch(() => {
          // Ignore errors — this is best-effort prefetch
        });
      });

      subscriptions.push(sub);
    }

    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeyKey]);
}
