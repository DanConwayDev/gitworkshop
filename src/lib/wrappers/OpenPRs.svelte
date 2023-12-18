<script lang="ts">
    import PRsList from "$lib/components/PRsList.svelte";
    import type { Args } from "$lib/components/PRsListItem.svelte";
    import { ndk } from "$lib/stores/ndk";

    export let limit: number = 100;

    let prs: Args[] = [];
    export let loading: boolean = true;
    let repo_kind: number = 30317;
    let pr_kind: number = 318;
    export let repo_id: string = "";

    let sub = ndk.subscribe({
        kinds: [pr_kind],
        "#d": [repo_id],
        limit,
    });
    sub.on("event", (event) => {
        if (prs.length < limit) {
            if (event.kind == pr_kind)
                prs = [
                    ...prs,
                    {
                        title: event.tagValue("name") || "",
                        author: event.pubkey,
                        created_at: event.created_at,
                        comments: 1,
                    },
                ];
        } else if (loading == true) loading = false;
    });
    sub.on("eose", () => {
        if (loading == true) loading = false;
    });
</script>

<PRsList title="Open PRs" {prs} {loading} />
