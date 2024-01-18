import { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { writable, type Unsubscriber, type Writable, get } from "svelte/store"
import { base_relays, ndk } from "./ndk";
import type { Repo } from "$lib/components/repo/type";
import { defaults } from "$lib/components/repo/type";
import type { User } from "$lib/components/users/type";
import { ensureUser, users } from "./users";
import { repo_kind } from "$lib/kinds";

export let selected_repo: Writable<Repo> = writable({ ...defaults });
let selected_repo_id: string = "";

let maintainers_unsubscribers: Unsubscriber[] = [];

export let ensureSelectedRepo = async (repo_id: string): Promise<Repo> => {
    if (selected_repo_id == repo_id) {
        return new Promise(r => {
            let unsubscriber = selected_repo.subscribe(repo => {
                if (repo.repo_id === repo_id && !repo.loading) {
                    setTimeout(() => {
                        unsubscriber();
                    }, 5);
                    r({ ...repo });
                }
            });

        })
    }
    selected_repo_id = repo_id;
    let sub = ndk.subscribe(
        {
            kinds: [repo_kind],
            '#d': [repo_id],
            limit: 1,
        },
        {},
        NDKRelaySet.fromRelayUrls(base_relays, ndk),
    );

    return new Promise((r) => {
        sub.on("event", (event) => {
            try {
                if (event.kind == repo_kind && event.tagValue("d") == repo_id) {
                    selected_repo.set({
                        loading: false,
                        repo_id: event.replaceableDTag(),
                        name: event.tagValue("name") || "",
                        description: event.tagValue("description") || "",
                        git_server: event.tagValue("git_server") || "",
                        tags: event.getMatchingTags("t") || [],
                        maintainers: event.getMatchingTags("p").map(
                            (t: string[]) =>
                                ({
                                    hexpubkey: t[1],
                                    loading: true,
                                    npub: "",
                                }) as User,
                        ),
                        relays: event
                            .getMatchingTags("relay")
                            .map((t: string[]) => t[1]),
                    });
                    let old_unsubscribers = maintainers_unsubscribers;
                    maintainers_unsubscribers = event
                        .getMatchingTags("p")
                        .map((t: string[]) => {
                            return ensureUser(t[1]).subscribe((u: User) => {
                                selected_repo.update((repo) => {
                                    return {
                                        ...repo,
                                        maintainers: repo.maintainers.map((m) => {
                                            if (m.hexpubkey == u.hexpubkey) return { ...u };
                                            else return { ...m };
                                        }),
                                    };
                                });
                            })
                        });
                    old_unsubscribers.forEach((unsubscriber) => unsubscriber());
                }
            } catch { }
        });

        sub.on("eose", () => {
            selected_repo.update((repo) => {
                r({
                    ...repo,
                    loading: false,
                });
                return {
                    ...repo,
                    loading: false,
                }
            })
        });
    });

}
