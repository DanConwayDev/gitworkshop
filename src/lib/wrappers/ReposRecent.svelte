<script lang="ts">
    import type { Args } from "$lib/components/RepoSummaryCard.svelte";
    import ReposSummaryList from "$lib/components/ReposSummaryList.svelte";
    import { ndk } from "$lib/stores/ndk";

    export let limit: number = 5;

    let repos: Args[] = [];
    let loading: boolean = true;
    let kind: number = 30017;
    let sub = ndk.subscribe({
        kinds: [kind],
        limit,
    });
    sub.on("event", (event) => {
        if (repos.length < limit) {
            if (event.kind == kind)
                repos = [
                    ...repos,
                    {
                        name: event.tagValue("name") || "",
                        description: event.tagValue("description") || "",
                    },
                ];
        } else if (loading == true) loading = false;
    });
    sub.on("eose", () => {
        if (loading == true) loading = false;
    });
</script>

<ReposSummaryList title="Latest Repositories" {repos} {loading} />
