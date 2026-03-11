import { use$ } from "./use$";
import { useUser } from "./useUser";
import type { ProfileContent } from "applesauce-core/helpers";

/**
 * Get a user's profile by their pubkey.
 * Automatically subscribes to profile updates via User cast.
 *
 * @param pubkey - The user's public key (hex format)
 * @returns The user's profile metadata, or undefined if not yet loaded
 *
 * @example
 * ```tsx
 * import { useProfile } from '@/hooks/useProfile';
 *
 * function UserCard({ pubkey }: { pubkey: string }) {
 *   const profile = useProfile(pubkey);
 *
 *   return (
 *     <div>
 *       <img src={profile?.picture} />
 *       <h3>{profile?.name ?? 'Anonymous'}</h3>
 *       <p>{profile?.about}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useProfile(
  pubkey: string | undefined,
): ProfileContent | undefined {
  const user = useUser(pubkey);

  const profile = use$(() => user?.profile$, [user?.pubkey]);

  return profile;
}

import { useMyUser } from "./useUser";

/**
 * Get the current user's own profile.
 * Convenience wrapper around useProfile that uses the logged-in account's pubkey.
 *
 * @example
 * ```tsx
 * import { useMyProfile } from '@/hooks/useProfile';
 * import { useActiveAccount } from 'applesauce-react/hooks';
 *
 * function ProfileSettings() {
 *   const account = useActiveAccount();
 *   const profile = useMyProfile();
 *
 *   if (!account) return <LoginPrompt />;
 *
 *   return (
 *     <div>
 *       <h2>Edit Profile</h2>
 *       <input defaultValue={profile?.name} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useMyProfile(): ProfileContent | undefined {
  const user = useMyUser();

  const profile = use$(() => user?.profile$, [user?.pubkey]);

  return profile;
}
