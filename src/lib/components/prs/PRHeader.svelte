<script lang="ts" context="module">
</script>

<script lang="ts">
    import dayjs from "dayjs";
    import relativeTime from "dayjs/plugin/relativeTime";
    import { summary_defaults } from "./type";
    import { getName } from "../users/type";
    import Container from "../Container.svelte";
    import Status from "./Status.svelte";

    dayjs.extend(relativeTime);
    export let { title, id, repo_id, comments, author, created_at, loading } =
        summary_defaults;
    let short_title: string;
    let created_at_ago: string;
    let author_name = "";
    $: {
        author_name = getName(author);
    }
    $: {
        if (title.length > 70) short_title = title.slice(0, 65) + "...";
        else if (title.length == 0) short_title = "Untitled";
        else short_title = title;
        created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : "";
    }
</script>

<div
    class="overflow-hidden grow text-xs text-neutral-content bg-base-200 border-b border-accent-content pt-2 pb-4"
>
    <Container>
        {#if loading}
            <div>
                <div class="h-7 w-60 pt-1 skeleton"></div>
                <div class="">
                    <div
                        class="h-8 w-20 mt-3 skeleton align-middle inline-block"
                    ></div>
                    <div
                        class="h-3 w-28 ml-3 mt-5 align-middle skeleton inline-block"
                    ></div>
                    <div
                        class="h-3 w-28 ml-3 mt-5 align-middle skeleton inline-block"
                    ></div>
                </div>
            </div>
        {:else}
            <div class="text-lg text-base-content mb-2">
                {short_title}
            </div>
            <div class="pt-1">
                <div class="inline mr-3 align-middle">
                    <Status status="Open" />
                </div>
                <div class="inline mr-3 align-middle">
                    opened {created_at_ago}
                </div>
                <div class="inline align-middle">
                    {#if author.loading}
                        <div class="skeleton h-3 pb-2 w-20 inline-block"></div>
                    {:else}
                        {author_name}
                    {/if}
                </div>
            </div>
        {/if}
    </Container>
</div>
