import { useState, useEffect } from "react";
import { IdentityStatus } from "applesauce-loaders/helpers";
import { dnsIdentityLoader } from "@/services/nostr";
import { standardizeNip05 } from "@/lib/routeUtils";
import { useUser } from "./useUser";
import { use$ } from "./use$";

/**
 * Reactively resolve a verified NIP-05 identity for a pubkey.
 *
 * Subscribes to the user's profile via the User cast. Once the profile's
 * nip05 field arrives, verifies it against the pubkey using the
 * DnsIdentityLoader (sync cache first, async fallback). Returns the
 * standardised NIP-05 string when verified, or undefined otherwise.
 *
 * On a warm cache the verified value is available on the first render
 * with no flicker.
 *
 * @param pubkey - hex pubkey to resolve
 * @returns standardised NIP-05 (e.g. "user@domain.com" or "_@domain.com"),
 *          or undefined if not yet verified / no nip05 on profile
 */
export function useVerifiedNip05(pubkey: string): string | undefined {
  const user = useUser(pubkey);
  const profile = use$(() => user?.profile$, [user?.pubkey]);
  const rawNip05 = profile?.metadata?.nip05;

  const [verifiedNip05, setVerifiedNip05] = useState<string | undefined>(() =>
    getVerifiedNip05FromCache(rawNip05, pubkey),
  );

  useEffect(() => {
    if (!rawNip05) {
      setVerifiedNip05(undefined);
      return;
    }

    const standardized = standardizeNip05(rawNip05);

    // Check cache synchronously first
    const cached = getVerifiedNip05FromCache(rawNip05, pubkey);
    if (cached !== undefined) {
      setVerifiedNip05(cached);
      return;
    }

    // Not yet cached — kick off async verification
    let cancelled = false;
    const atIdx = standardized.indexOf("@");
    if (atIdx === -1) return;
    const name = standardized.slice(0, atIdx);
    const domain = standardized.slice(atIdx + 1);

    dnsIdentityLoader
      .loadIdentity(name, domain)
      .then((identity) => {
        if (cancelled) return;
        if (
          identity.status === IdentityStatus.Found &&
          identity.pubkey === pubkey
        ) {
          setVerifiedNip05(standardized);
        } else {
          setVerifiedNip05(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setVerifiedNip05(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [rawNip05, pubkey]);

  return verifiedNip05;
}

/**
 * Synchronously check the dnsIdentityLoader cache for a verified NIP-05.
 * Returns the standardised NIP-05 string if verified for the given pubkey,
 * or undefined if not cached / not matching.
 */
function getVerifiedNip05FromCache(
  nip05: string | undefined,
  pubkey: string,
): string | undefined {
  if (!nip05) return undefined;
  const standardized = standardizeNip05(nip05);
  const atIdx = standardized.indexOf("@");
  if (atIdx === -1) return undefined;
  const name = standardized.slice(0, atIdx);
  const domain = standardized.slice(atIdx + 1);
  const cached = dnsIdentityLoader.getIdentity(name, domain);
  if (
    cached &&
    cached.status === IdentityStatus.Found &&
    cached.pubkey === pubkey
  ) {
    return standardized;
  }
  return undefined;
}
