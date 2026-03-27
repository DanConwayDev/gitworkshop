import { userToPath } from "@/lib/routeUtils";
import { useVerifiedNip05 } from "./useVerifiedNip05";

/**
 * Returns the canonical path for a user profile, preferring a verified
 * NIP-05 identity over the npub when one is available.
 *
 * Returns a path immediately (using npub as fallback) and updates
 * reactively once NIP-05 verification completes.
 *
 * @param pubkey - hex pubkey
 */
export function useUserPath(pubkey: string): string {
  const verifiedNip05 = useVerifiedNip05(pubkey);
  return userToPath(pubkey, verifiedNip05);
}
