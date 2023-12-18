<script lang="ts">
    import type { Args } from "$lib/components/RepoDetails.svelte";
    import { defaults } from "$lib/components/RepoDetails.svelte";
    import RepoDetails from "$lib/components/RepoDetails.svelte";
    import { ndk } from "$lib/stores/ndk";

    export let repo_id = "";

    let repo: Args = { ...defaults };
    let loading: boolean = true;
    let kind: number = 30317;
    let sub = ndk.subscribe({
        kinds: [kind],
        limit: 1,
    });
    sub.on("event", (event) => {
        try {
            if (event.kind == kind && event.tagValue("d") == repo_id)
                repo = {
                    repo_id: event.replaceableDTag(),
                    name: event.tagValue("name") || "",
                    description: event.tagValue("description") || "",
                    git_server: event.tagValue("git_server") || "",
                    tags: event.getMatchingTags("t") || [],
                    maintainers: event
                        .getMatchingTags("p")
                        .map((t: string[]) => t[1]),
                    relays: event
                        .getMatchingTags("relay")
                        .map((t: string[]) => t[1]),
                };
        } catch {}
    });
    sub.on("eose", () => {
        if (loading == true) loading = false;
    });
</script>

<RepoDetails {...repo} {loading} />
