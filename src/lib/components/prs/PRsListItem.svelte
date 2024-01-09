<script lang="ts" context="module">
</script>

<script lang="ts">
    import dayjs from "dayjs";
    import relativeTime from "dayjs/plugin/relativeTime";
    import { defaults } from "./type";
    import { getName } from "../users/type";

    dayjs.extend(relativeTime);
    export let { title, id, comments, author, created_at, loading } = defaults;
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

<li
    class="flex p-2 pt-4 {!loading
        ? 'hover:bg-neutral-700 cursor-pointer'
        : ''}"
>
    <!-- <figure class="p-4 pl-0 text-color-primary"> -->
    <!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
    {#if loading}
        <div class="h-5 w-5 pt-1 flex-none skeleton"></div>
    {:else}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="h-5 w-5 pt-1 flex-none fill-success"
            ><path
                d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25m5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354M3.75 2.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m0 9.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m8.25.75a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0"
            />
        </svg>
    {/if}
    <!-- <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                class="fill-base-content"
                ><path
                    d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1m9.5 14a2.25 2.25 0 1 1 0-4.5a2.25 2.25 0 0 1 0 4.5M2.5 3.25a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0M3.25 12a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m9.5 0a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5M14 7.5a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 0 1 2.5 0m0-4.25a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 0 1 2.5 0"
                /></svg
            > -->
    <div class="ml-3 overflow-hidden grow text-xs text-neutral-content">
        {#if loading}
            <div class="h-5 w-60 pt-1 flex-none skeleton"></div>
            <div class="h-3 w-40 mt-3 mb-1 flex-none skeleton"></div>
        {:else}
            <div class="text-sm text-base-content">
                {short_title}
            </div>
            <!-- <div class="text-xs text-neutral-content">
                {description}
            </div> -->
            <ul class="pt-2">
                {#if comments > 0}
                    <li class="align-middle inline mr-3">
                        <!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-3 w-3 pt-0 flex-none fill-base-content inline-block"
                            viewBox="0 0 16 16"
                            ><path
                                d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
                            /></svg
                        >
                        {comments}
                    </li>
                {/if}
                <li class="inline mr-3">
                    opened {created_at_ago}
                </li>
                <li class="inline">
                    {#if author.loading}
                        <div class="skeleton h-3 pb-2 w-20 inline-block"></div>
                    {:else}
                        {author_name}
                    {/if}
                </li>
            </ul>
        {/if}
    </div>
    <!-- <div class="flex-none text-xs pt-0 hidden md:block">
        <div class="align-middle">
            {#if loading}
                <div class="skeleton w-10 h-10"></div>
            {:else}
                <Avatar />
            {/if}
        </div>
    </div> -->
</li>
