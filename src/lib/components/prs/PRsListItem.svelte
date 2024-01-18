<script lang="ts" context="module">
</script>

<script lang="ts">
    import dayjs from "dayjs";
    import relativeTime from "dayjs/plugin/relativeTime";
    import { summary_defaults } from "./type";
    import { getName } from "../users/type";
    import { pr_icon_path } from "./icons";

    dayjs.extend(relativeTime);
    export let {
        title,
        id,
        repo_id,
        comments,
        status,
        author,
        created_at,
        loading,
    } = summary_defaults;
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
    {#if loading || !status}
        <div class="h-5 w-5 pt-1 flex-none skeleton"></div>
    {:else if status === "Open"}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="h-5 w-5 pt-1 flex-none fill-success"
            ><path d={pr_icon_path.open} /></svg
        >
    {:else if status === "Closed"}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="h-5 w-5 pt-1 flex-none fill-neutral-content"
            ><path d={pr_icon_path.close} /></svg
        >
    {:else if status === "Draft"}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="h-5 w-5 pt-1 flex-none fill-neutral-content"
            ><path d={pr_icon_path.draft} /></svg
        >
    {:else if status === "Merged"}
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            class="h-5 w-5 pt-1 flex-none fill-primary"
            ><path d={pr_icon_path.merge} /></svg
        >
    {/if}
    <a
        href="/repo/{repo_id}/pr/{id}"
        class="ml-3 overflow-hidden grow text-xs text-neutral-content"
    >
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
    </a>
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
