import { useMemo } from "react";
import { useEventStore } from "./useEventStore";
import { castUser, type User } from "applesauce-common/casts";
import { useActiveAccount } from "applesauce-react/hooks";

/**
 * Get a User cast for a given pubkey.
 * The User cast provides reactive access to profile, follows, mailboxes, etc.
 *
 * @param pubkey - The user's public key (hex format)
 * @returns User cast, or undefined if pubkey is empty
 *
 * @example
 * ```tsx
 * import { useUser } from '@/hooks/useUser';
 * import { use$ } from '@/hooks/use$';
 *
 * function UserCard({ pubkey }: { pubkey: string }) {
 *   const user = useUser(pubkey);
 *   const profile = use$(() => user?.profile$);
 *   const follows = use$(() => user?.follows$);
 *
 *   return (
 *     <div>
 *       <img src={profile?.picture} />
 *       <h3>{profile?.name ?? 'Anonymous'}</h3>
 *       <p>Following {follows?.length ?? 0} users</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUser(pubkey: string | undefined): User | undefined {
  const store = useEventStore();

  const user = useMemo(() => {
    if (!pubkey) return undefined;
    // @ts-expect-error - EventStore type compatibility with CastRefEventStore
    return castUser(pubkey, store);
  }, [pubkey, store]);

  return user;
}

/**
 * Get the User cast for the currently logged-in account.
 * Returns undefined if no account is logged in.
 *
 * @example
 * ```tsx
 * import { useMyUser } from '@/hooks/useUser';
 * import { use$ } from '@/hooks/use$';
 *
 * function MyProfile() {
 *   const user = useMyUser();
 *   const profile = use$(() => user?.profile$);
 *   const outboxes = use$(() => user?.outboxes$);
 *
 *   if (!user) return <LoginPrompt />;
 *
 *   return (
 *     <div>
 *       <h2>{profile?.name}</h2>
 *       <p>Publishing to {outboxes?.length ?? 0} relays</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useMyUser(): User | undefined {
  const account = useActiveAccount();
  const pubkey = account?.pubkey;

  return useUser(pubkey);
}
