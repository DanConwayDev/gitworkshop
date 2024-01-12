import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { writable, type Unsubscriber, type Writable } from "svelte/store"
import { ndk } from "./ndk";
import type { Repo } from "$lib/components/repo/type";
import { summary_defaults } from "$lib/components/prs/type";
import type { User } from "$lib/components/users/type";
import { ensureUser, users } from "./users";
import type { PRSummaries, PRSummary } from "$lib/components/prs/type";

export let pr_summaries: Writable<PRSummaries> = writable({
    id: "",
    summaries: [],
    loading: false,
});

let pr_kind: number = 318;

let selected_repo_id: string = "";

let authors_unsubscribers: Unsubscriber[] = [];

export let ensurePRSummaries = (repo_id: string) => {
    if (selected_repo_id == repo_id) return;
    if (repo_id == "") return pr_summaries.set({
        id: "",
        summaries: [],
        loading: false,
    });

    selected_repo_id = repo_id;
    pr_summaries.update(prs => {
        return {
            ...prs,
            id: repo_id,
            loading: true,
        };
    });
    authors_unsubscribers.forEach(u => u());
    authors_unsubscribers = [];

    let sub = ndk.subscribe({
        kinds: [pr_kind],
        '#r': [`r-${repo_id}`],
        limit: 50,
    });

    sub.on("event", (event: NDKEvent) => {
        try {
            if (event.kind == pr_kind
                && event.getMatchingTags("r").find(t => t[1] === `r-${repo_id}`)
            ) {
                pr_summaries.update(prs => {
                    return {
                        ...prs,
                        summaries: [
                            ...prs.summaries,
                            {
                                ...summary_defaults,
                                id: event.id,
                                repo_id: repo_id,
                                title: event.tagValue("name") || "",
                                descritpion: event.tagValue("description") || "",
                                created_at: event.created_at,
                                comments: 0,
                                author: {
                                    hexpubkey: event.pubkey,
                                    loading: true,
                                    npub: "",
                                },
                                loading: false,
                            }
                        ],
                    }
                });

                authors_unsubscribers.push(
                    ensureUser(event.pubkey).subscribe((u: User) => {
                        pr_summaries.update(prs => {
                            return {
                                ...prs,
                                summaries: prs.summaries.map(o => ({
                                    ...o,
                                    author: u,
                                })),
                            }
                        });
                    })
                );
            }
        } catch { }
    });
    sub.on("eose", () => {
        pr_summaries.update(prs => {
            return {
                ...prs,
                loading: false,
            };
        });
    });
}
