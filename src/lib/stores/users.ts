import { defaults as user_defaults, type User } from "$lib/components/users/type";
import { NDKNip07Signer, NDKRelayList } from "@nostr-dev-kit/ndk";
import { get, writable, type Unsubscriber, type Writable } from "svelte/store"
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
        getUserRelays(hexpubkey);
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

export let returnUser = async (hexpubkey: string): Promise<User> => {
    return new Promise((r) => {
        let unsubscriber = ensureUser(hexpubkey).subscribe((u) => {
            if (!u.loading) {
                unsubscriber();
                r(u);
            }
        });
    });
}

// nip07_plugin is set in Navbar component
export let nip07_plugin: Writable<undefined | boolean> = writable(undefined);

export let checkForNip07Plugin = () => {
    if (window.nostr) {
        nip07_plugin.set(true);
    } else {
        let timerId: NodeJS.Timeout;
        const intervalId = setInterval(() => {
            if (window.nostr) {
                clearTimeout(timerId);
                clearInterval(intervalId);
                nip07_plugin.set(true);
            }
        }, 100);
        timerId = setTimeout(() => {
            clearInterval(intervalId);
            nip07_plugin.set(false);
        }, 5000);
    }

};

let signer = new NDKNip07Signer(2000);

export let logged_in_user: Writable<undefined | User> = writable(undefined);

export let login = async (): Promise<void> => {
    return new Promise(async (res, rej) => {
        let user = get(logged_in_user);
        if (user) return res();
        if (get(nip07_plugin)) {
            try {
                let ndk_user = await signer.blockUntilReady();
                logged_in_user.set({
                    ...user_defaults,
                    hexpubkey: ndk_user.pubkey,
                });
                ndk.signer = signer;
                ensureUser(ndk_user.pubkey).subscribe(user => {
                    logged_in_user.set({ ...user });
                });
                return res();
            }
            catch (e) {
                alert(e);
                rej();
            }
        }
        else {
            rej();
        }
    });
};

interface UserRelays {
    loading: boolean;
    ndk_relays: NDKRelayList | undefined;
}

export let user_relays: { [hexpubkey: string]: Writable<UserRelays>; } = {};

export let getUserRelays = async (hexpubkey: string): Promise<UserRelays> => {
    return new Promise(async (res, rej) => {
        if (user_relays[hexpubkey]) {
            let unsubscriber: Unsubscriber;
            unsubscriber = user_relays[hexpubkey].subscribe(querying_user_relays => {
                if (querying_user_relays && !querying_user_relays.loading) {
                    res(querying_user_relays);
                    if (unsubscriber) unsubscriber();
                }
            });
        }
        else {
            user_relays[hexpubkey] = writable({
                loading: true,
                ndk_relays: undefined,
            });
            let relay_list = await ndk.getUser({ hexpubkey }).relayList();
            let querying_user_relays = {
                loading: false,
                ndk_relays: relay_list,
            };
            user_relays[hexpubkey].set({ ...querying_user_relays });
            res(querying_user_relays);
        }
    });
};
