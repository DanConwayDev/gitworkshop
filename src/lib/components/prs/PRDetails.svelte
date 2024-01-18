<script lang="ts">
    import { full_defaults } from "./type";
    import UserHeader from "../users/UserHeader.svelte";
    import StatusSelector from "./StatusSelector.svelte";

    export let { summary, labels, loading } = { ...full_defaults };
</script>

<div class="max-w-md">
    <div>
        {#if loading}
            <div class="h-5 my-3 skeleton w-20"></div>
            <div class="badge skeleton my-2 w-60 block"></div>
            <div class="badge skeleton my-2 w-40 block"></div>
        {:else}
            <h4>Author</h4>
            <UserHeader user={summary.author} />
        {/if}
    </div>

    <div>
        {#if loading}
            <div class="h-5 my-3 skeleton w-20"></div>
            <div class="badge skeleton my-2 w-60 block"></div>
            <div class="badge skeleton my-2 w-40 block"></div>
        {:else}
            <h4>Status</h4>
            <StatusSelector
                status={summary.status}
                repo_id={summary.repo_id}
                pr_id={summary.id}
            />
        {/if}
    </div>

    <div>
        {#if loading}
            <div class="badge skeleton w-20"></div>
            <div class="badge skeleton w-20"></div>
        {:else}
            <h4>Labels</h4>
            {#each labels as label}
                <div class="badge badge-secondary mr-2">{label}</div>
            {/each}
        {/if}
    </div>
</div>
