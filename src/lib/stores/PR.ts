import { NDKRelaySet, type NDKEvent, NDKSubscription } from "@nostr-dev-kit/ndk";
import { writable, type Unsubscriber, type Writable } from "svelte/store"
import { ndk } from "./ndk";
import type { User } from "$lib/components/users/type";
import { ensureUser } from "./users";
import { type PRFull, full_defaults, isPRStatus, type PRStatus } from "$lib/components/prs/type";
import { pr_kind, pr_status_kind } from "$lib/kinds";
import { ensureSelectedRepo } from "./repo";

export let selected_pr_full: Writable<PRFull> = writable({ ...full_defaults });

let selected_pr_repo_id: string = "";
let selected_pr_id: string = "";
let pr_summary_author_unsubsriber: Unsubscriber | undefined;

export let selected_pr_replies: Writable<NDKEvent[]> = writable([]);

let selected_pr_status_date = 0;

let sub: NDKSubscription;

let sub_replies: NDKSubscription;

export let ensurePRFull = (repo_id: string, pr_id: string) => {
    if (selected_pr_id == pr_id) return;
    if (pr_id == "") {
        selected_pr_full.set({ ...full_defaults });
        selected_pr_replies.set([]);
        return;
    }

    selected_pr_repo_id = repo_id;
    selected_pr_id = pr_id;
    selected_pr_status_date = 0;
    selected_pr_replies.set([]);

    selected_pr_full.set({
        ...full_defaults,
        summary: {
            ...full_defaults.summary,
            id: pr_id,
            repo_id: repo_id,
            loading: true,
        },
        loading: true,
    });
    if (pr_summary_author_unsubsriber) pr_summary_author_unsubsriber();
    pr_summary_author_unsubsriber = undefined;

    new Promise(async (r) => {
        let repo = await ensureSelectedRepo(repo_id);

        if (sub) sub.stop();
        sub = ndk.subscribe(
            {
                ids: [pr_id],
                kinds: [pr_kind],
                '#r': [`r-${repo_id}`],
                limit: 50,
            },
            {
                closeOnEose: false,
            },
            NDKRelaySet.fromRelayUrls(repo.relays, ndk),
        );

        sub.on("event", (event: NDKEvent) => {
            try {
                if (event.kind == pr_kind
                    && event.getMatchingTags("r").find(t => t[1] === `r-${repo_id}`)
                    && event.id == pr_id
                ) {
                    selected_pr_full.update(full => {
                        return {
                            ...full,
                            pr_event: event,
                            summary: {
                                ...full.summary,
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
                let updated = {
                    ...full,
                    summary: {
                        ...full.summary,
                        loading: false,
                    },
                };
                if (full.loading === false) {
                    r({ ...updated });
                }
                return updated;
            });
        });

        if (sub_replies) sub_replies.stop();
        sub_replies = ndk.subscribe(
            {
                "#e": [pr_id],
            },
            {
                closeOnEose: false
            },
            NDKRelaySet.fromRelayUrls(repo.relays, ndk),
        );

        sub_replies.on("event", (event: NDKEvent) => {
            if (event.kind == pr_status_kind
                && event.created_at && selected_pr_status_date < event.created_at
                && event.getMatchingTags("t").length === 1
                && event.getMatchingTags("t")[0].length > 1
            ) {
                let potential_status = event.getMatchingTags("t")[0][1];

                if (isPRStatus(potential_status)) {
                    selected_pr_status_date = event.created_at;
                    selected_pr_full.update(full => {
                        return {
                            ...full,
                            summary: {
                                ...full.summary,
                                status: potential_status as PRStatus,
                                // this wont be 0 as we are ensuring it is not undefined above
                                status_date: event.created_at || 0,
                            },
                        };
                    });
                }
            }
            selected_pr_replies.update(replies => {
                return [
                    ...replies,
                    event,
                ];
            });
        });

        sub_replies.on("eose", () => {
            selected_pr_full.update(full => {
                let updated = {
                    ...full,
                    summary: {
                        ...full.summary,
                        status: full.summary.status || "Open",
                    },
                    loading: false,
                };
                if (full.summary.loading === false) {
                    r({ ...updated });
                }
                return updated;
            });
        });
    });
}
