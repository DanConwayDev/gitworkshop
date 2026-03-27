import { repoToPath } from "@/lib/routeUtils";
import { useVerifiedNip05 } from "./useVerifiedNip05";

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
  const verifiedNip05 = useVerifiedNip05(pubkey);
  return repoToPath(pubkey, repoId, relays, verifiedNip05);
}
