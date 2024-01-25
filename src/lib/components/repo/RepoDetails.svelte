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
    $: short_descrption =
        description.length > 500
            ? description.slice(0, 450) + "..."
            : description;
</script>

<div class="max-w-md prose w-full">
    {#if loading}
        <div class="h-5 my-3 skeleton w-20"></div>
        <div class="h-4 my-2 skeleton"></div>
        <div class="h-4 my-2 mb-3 w-2/3 skeleton"></div>
    {:else if description.length == 0}
        <div />
    {:else}
        <h4>description</h4>
        <p class="text-sm my-2 break-words">{short_descrption}</p>
    {/if}
    <div>
        {#if loading}
            <div class="badge skeleton w-20"></div>
            <div class="badge skeleton w-20"></div>
        {:else}
            {#each tags as tag}
                <div class="badge badge-secondary mr-2">{tag}</div>
            {/each}
        {/if}
    </div>
    <div>
        {#if loading}
            <div class="h-5 my-3 skeleton w-20"></div>
            <div class="badge skeleton my-2 w-60 block"></div>
        {:else if git_server.length == 0}
            <div />
        {:else}
            <h4>git server</h4>
            <a
                href={git_server}
                target="_blank"
                class="link link-primary break-words my-2"
            >
                {git_server}
            </a>
        {/if}
    </div>
    <div>
        {#if loading}
            <div class="h-5 my-3 skeleton w-20"></div>
            <div class="badge skeleton my-2 w-60 block"></div>
            <div class="badge skeleton my-2 w-40 block"></div>
        {:else if maintainers.length == 0}
            <div />
        {:else}
            <h4>maintainers</h4>
            {#each maintainers as maintainer}
                <UserHeader user={maintainer} />
            {/each}
        {/if}
    </div>
    <div>
        {#if loading}
            <div class="h-5 my-3 skeleton w-20"></div>
            <div class="badge skeleton my-2 w-60 block"></div>
            <div class="badge skeleton my-2 w-40 block"></div>
        {:else if relays.length == 0}
            <div />
        {:else}
            <h4>relays</h4>
            {#each relays as relay}
                <div class="badge badge-secondary block my-2">{relay}</div>
            {/each}
        {/if}
    </div>
</div>
