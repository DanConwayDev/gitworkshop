import { useMemo } from "react";
import { use$ } from "@/hooks/use$";
import { useMyUser } from "@/hooks/useUser";
import type { ProfileContent } from "applesauce-core/helpers";
import type { User } from "applesauce-common/casts";

export interface ContactSearchResult {
  pubkey: string;
  profile: ProfileContent | undefined;
}

/**
 * Search the current user's contact list by query string.
 *
 * - If query is empty, returns the first 8 contacts sorted alphabetically by display name.
 * - If query is non-empty, filters contacts whose name, displayName, or nip05
 *   contains the query (case-insensitive). Returns max 8 results.
 * - Returns [] when the user is not logged in.
 */
export function useContactSearch(query: string): ContactSearchResult[] {
  const myUser = useMyUser();

  // Subscribe to the current user's contact list (User[])
  const contacts = use$(() => myUser?.contacts$, [myUser?.pubkey]);

  // Build a flat list of { pubkey, profile } from the contacts array.
  // Each contact is a User cast — subscribe to their profile$ individually.
  // Because hooks cannot be called conditionally or inside loops, we derive
  // the profile data from the User objects synchronously via the EventStore
  // (the User cast's profile$ is a ChainableObservable backed by the store).
  //
  // We use a single use$() call on the contacts array and then map over it
  // to extract the profile synchronously from each User's cached observable.
  // This avoids calling hooks in a loop while still being reactive.

  const results = useMemo<ContactSearchResult[]>(() => {
    if (!contacts || contacts.length === 0) return [];

    const lowerQuery = query.toLowerCase();

    // Build result list from contacts
    const all: ContactSearchResult[] = contacts.map((user: User) => {
      // Access the current value of the profile$ observable synchronously.
      // ChainableObservable extends Observable, so we use getValue() if
      // available, otherwise fall back to undefined (profile not yet loaded).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileObs = user.profile$ as any;
      const profile: ProfileContent | undefined =
        typeof profileObs?.getValue === "function"
          ? (profileObs.getValue() as ProfileContent | undefined)
          : undefined;

      return { pubkey: user.pubkey, profile };
    });

    // Filter by query
    const filtered =
      lowerQuery.length === 0
        ? all
        : all.filter(({ profile }) => {
            if (!profile) return false;
            const name = (profile.name ?? "").toLowerCase();
            const displayName = (
              profile.display_name ??
              profile.displayName ??
              ""
            ).toLowerCase();
            const nip05 = (profile.nip05 ?? "").toLowerCase();
            return (
              name.includes(lowerQuery) ||
              displayName.includes(lowerQuery) ||
              nip05.includes(lowerQuery)
            );
          });

    // Sort alphabetically by display name
    filtered.sort((a, b) => {
      const nameA = (
        a.profile?.display_name ??
        a.profile?.displayName ??
        a.profile?.name ??
        a.pubkey
      ).toLowerCase();
      const nameB = (
        b.profile?.display_name ??
        b.profile?.displayName ??
        b.profile?.name ??
        b.pubkey
      ).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return filtered.slice(0, 8);
  }, [contacts, query]);

  return results;
}
