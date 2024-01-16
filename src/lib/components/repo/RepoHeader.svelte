<script lang="ts" context="module">
    import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
</script>

<script lang="ts">
    import type { User } from "$lib/components/users/type";
    import UserHeader from "$lib/components/users/UserHeader.svelte";
    import Container from "../Container.svelte";
    import { defaults } from "./type";

    export let {
        repo_id,
        name,
        description,
        git_server,
        tags,
        maintainers,
        relays,
        loading,
    } = defaults;
    let short_name: string;
    $: {
        if (name.length > 45) short_name = name.slice(0, 45) + "...";
        else if (name.length == 0) short_name = "Untitled";
        else short_name = name;
    }
</script>

<div class="bg-base-300 border-b border-accent-content">
    <Container no_wrap={true}>
        {#if loading}
            <div class="p-3">
                <div class="h-6 skeleton w-28 bg-base-200"></div>
            </div>
        {:else}
            <a
                href={`/repo/${repo_id}`}
                class="btn btn-ghost text-sm break-words strong mt-0 mb-0 px-3"
                >{short_name}</a
            >
        {/if}
    </Container>
</div>
