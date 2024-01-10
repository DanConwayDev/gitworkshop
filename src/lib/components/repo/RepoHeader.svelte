<script lang="ts" context="module">
    import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
</script>

<script lang="ts">
    import type { User } from "$lib/components/users/type";
    import UserHeader from "$lib/components/users/UserHeader.svelte";
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

<div class="bg-base-300 py-2 border-b border-accent-content">
    <div class="mx-auto lg:container">
        <div class="max-w-md prose px-3">
            {#if loading}
                <div class="h-5 my-2 skeleton w-28"></div>
            {:else}
                <h4 class="text-sm my-1 break-words">{short_name}</h4>
            {/if}
        </div>
    </div>
</div>
