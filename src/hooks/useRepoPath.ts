import { useState, useEffect } from "react";
import { IdentityStatus } from "applesauce-loaders/helpers";
import { dnsIdentityLoader } from "@/services/nostr";
import { repoToPath, standardizeNip05 } from "@/lib/routeUtils";
import { useProfile } from "./useProfile";

/**
 * Returns the canonical path for a repository, preferring a verified NIP-05
 * identity segment over the npub when one is available.
 *
 * The hook returns a path immediately (using npub as fallback) and updates
 * reactively once NIP-05 verification completes. If the profile's nip05 field
 * is already cached from a previous lookup the NIP-05 path is returned on the
 * first render with no flicker.
 *
 * @param pubkey  - hex pubkey of the repo maintainer
 * @param repoId  - the repo d-tag identifier
 * @param relays  - relay list (first entry used as hint)
 */
export function useRepoPath(
  pubkey: string,
  repoId: string,
  relays: string[],
): string {
  const profile = useProfile(pubkey);
  const rawNip05 = profile?.nip05;

  // Attempt to get a verified NIP-05 for this pubkey.
  // We check the loader's synchronous cache first so there's no flicker when
  // the identity was already resolved earlier in the session.
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
    const cached = getVerifiedNip05FromCache(standardized, pubkey);
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

  return repoToPath(pubkey, repoId, relays, verifiedNip05);
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
