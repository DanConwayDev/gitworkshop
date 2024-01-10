<script lang="ts" context="module">
</script>

<script lang="ts">
    import dayjs from "dayjs";
    import relativeTime from "dayjs/plugin/relativeTime";
    import { summary_defaults } from "./type";
    import { getName } from "../users/type";

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
    class="overflow-hidden grow text-xs text-neutral-content bg-base-200 border-b border-accent-content pt-2 pb-4 px-3"
>
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
            <button class="btn btn-success btn-sm mr-3 align-middle">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 18 18"
                    class="h-5 w-5 pt-1 flex-none fill-success-content"
                    ><path
                        d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25m5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354M3.75 2.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m0 9.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m8.25.75a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0"
                    />
                </svg>
                Open
            </button>
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
</div>
