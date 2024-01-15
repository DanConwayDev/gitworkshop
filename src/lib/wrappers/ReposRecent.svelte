<script lang="ts">
    import type { Args } from "$lib/components/RepoSummaryCard.svelte";
    import ReposSummaryList from "$lib/components/ReposSummaryList.svelte";
    import { repo_kind } from "$lib/kinds";
    import { ndk } from "$lib/stores/ndk";

    export let limit: number = 5;

    let repos: Args[] = [];
    let loading: boolean = true;
    let sub = ndk.subscribe({
        kinds: [repo_kind],
        limit,
    });
    sub.on("event", (event) => {
        if (repos.length < limit) {
            try {
                if (event.kind == repo_kind)
                    repos = [
                        ...repos,
                        {
                            name: event.tagValue("name") || "",
                            description: event.tagValue("description") || "",
                            repo_id: event.replaceableDTag(),
                        },
                    ];
            } catch {}
        } else if (loading == true) loading = false;
    });
    sub.on("eose", () => {
        if (loading == true) loading = false;
    });
</script>

<ReposSummaryList title="Latest Repositories" {repos} {loading} />
