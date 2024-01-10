import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { writable, type Unsubscriber, type Writable } from "svelte/store"
import { ndk } from "./ndk";
import type { User } from "$lib/components/users/type";
import { ensureUser } from "./users";
import { type PRFull, full_defaults } from "$lib/components/prs/type";

let pr_kind: number = 318;

export let selected_pr_full: Writable<PRFull> = writable({ ...full_defaults });

let selected_repo_id: string = "";
let selected_pr_id: string = "";
let pr_summary_author_unsubsriber: Unsubscriber | undefined;

export let ensurePRFull = (repo_id: string, pr_id: string) => {
    if (selected_pr_id == pr_id) return;
    if (pr_id == "") return selected_pr_full.set({ ...full_defaults });

    selected_repo_id = repo_id;
    selected_pr_id = pr_id;

    selected_pr_full.update(full => {
        return {
            ...full,
            summary: {
                ...full.summary,
                id: pr_id,
                repo_id: repo_id,
                loading: true,
            },
            loading: true,
        };
    });
    if (pr_summary_author_unsubsriber) pr_summary_author_unsubsriber();
    pr_summary_author_unsubsriber = undefined;

    let sub = ndk.subscribe({
        ids: [pr_id],
        limit: 1,
    });

    sub.on("event", (event: NDKEvent) => {
        try {
            if (event.kind == pr_kind
                && event.getMatchingTags("r").find(t => t[1] === `r-${repo_id}`)
                && event.id == pr_id
            ) {

                selected_pr_full.update(full => {
                    return {
                        ...full,
                        summary: {
                            ...full.summary,
                            title: event.tagValue("name") || "",
                            created_at: event.created_at,
                            comments: 0,
                            author: {
                                hexpubkey: event.pubkey,
                                loading: true,
                                npub: "",
                            },
                            loading: false,
                        }
                    };
                });

                pr_summary_author_unsubsriber = ensureUser(event.pubkey).subscribe((u: User) => {
                    selected_pr_full.update(full => {
                        return {
                            ...full,
                            summary: {
                                ...full.summary,
                                author: event.pubkey == u.hexpubkey ? u : full.summary.author,
                            }
                        };
                    });
                });
            }
        } catch { }
    });

    sub.on("eose", () => {
        selected_pr_full.update(full => {
            return {
                ...full,
                summary: {
                    ...full.summary,
                    loading: false,
                },
                loading: false,
            };
        });
    });
}
