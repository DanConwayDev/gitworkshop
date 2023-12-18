<script lang="ts">
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";

    import PRsListItem, {
        type Args as PRsListItemArgs,
    } from "$lib/components/PRsListItem.svelte";

    export let title: string = "";
    export let prs: PRsListItemArgs[] = [];
    export let loading: boolean = false;
</script>

<div class="">
    {#if title.length > 0}
        <div class="prose">
            <h4>{title}</h4>
        </div>
    {/if}
    {#if prs.length == 0 && !loading}
        <p class="prose">None</p>
    {/if}
    <ul class=" divide-y divide-neutral-600">
        {#each prs as { title, comments, author, created_at }}
            <PRsListItem {title} {comments} {author} {created_at} />
        {/each}
        {#if loading}
            <PRsListItem loading={true} />
            {#if prs.length == 0}
                <PRsListItem loading={true} />
                <PRsListItem loading={true} />
            {/if}
        {/if}
    </ul>
</div>
