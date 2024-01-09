import type { User } from "$lib/components/users/type";
import { NDKUser } from "@nostr-dev-kit/ndk";
import { writable, type Writable } from "svelte/store"
import { ndk } from "./ndk";

export let users: { [hexpubkey: string]: Writable<User>; } = {};

export let ensureUser = (hexpubkey: string): Writable<User> => {
    if (!users[hexpubkey]) {
        let u = ndk.getUser({ hexpubkey });

        let base: User = {
            loading: false,
            hexpubkey,
            npub: u.npub,
        };

        users[hexpubkey] = writable(base);
        u.fetchProfile().then(
            (p) => {
                users[hexpubkey].update((u) => ({
                    ...u,
                    loading: false,
                    profile: p === null ? undefined : p,
                }));
            },
            () => {
                users[hexpubkey].update((u) => ({
                    ...u,
                    loading: false,
                }));
            }
        );
    }
    return users[hexpubkey];
}
