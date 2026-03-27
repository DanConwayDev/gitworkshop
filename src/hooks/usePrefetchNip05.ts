import { useEffect } from "react";
import { useUser } from "./useUser";
import { dnsIdentityLoader } from "@/services/nostr";
import { standardizeNip05 } from "@/lib/routeUtils";

/**
 * Prefetch NIP-05 identity for a single pubkey.
 *
 * Watches the profile reactively via the User cast. Once the profile arrives
 * and contains a nip05 field, requestIdentity() is called so the result is
 * stored in the IDB cache for instant lookup later.
 *
 * This is fire-and-forget — no state is returned.
 */
function usePrefetchNip05Single(pubkey: string | undefined): void {
  const user = useUser(pubkey);

  useEffect(() => {
    if (!user) return;

    // Subscribe to the profile observable; fire requestIdentity when nip05 arrives.
    // profile$ emits the Profile cast — use dnsIdentity (the nip05 field).
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

    return () => sub.unsubscribe();
  }, [user]);
}

/**
 * Prefetch NIP-05 identities for a list of pubkeys.
 *
 * For each pubkey, subscribes to the profile reactively. Once a profile
 * arrives with a nip05 field, the identity is requested from the
 * DnsIdentityLoader and persisted to IndexedDB. Subsequent lookups (e.g.
 * in useRepoPath) will hit the IDB cache synchronously.
 *
 * This is fire-and-forget — no state is returned.
 *
 * @param pubkeys - Array of hex pubkeys to prefetch
 */
export function usePrefetchNip05(pubkeys: string[]): void {
  // We call the single-pubkey hook for each entry. The list is expected to be
  // short (repo maintainers, page author) so the fixed-length constraint of
  // hooks is satisfied in practice. For dynamic-length lists we cap at a
  // reasonable maximum to keep hook count stable.
  usePrefetchNip05Single(pubkeys[0]);
  usePrefetchNip05Single(pubkeys[1]);
  usePrefetchNip05Single(pubkeys[2]);
  usePrefetchNip05Single(pubkeys[3]);
  usePrefetchNip05Single(pubkeys[4]);
}
