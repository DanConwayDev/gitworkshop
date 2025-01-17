<script lang="ts">
	import {
		proposal_status_applied,
		proposal_status_closed,
		proposal_status_draft,
		proposal_status_open
	} from '$lib/kinds';
	import { nip19 } from 'nostr-tools';
	import { pr_icon_path } from '../prs/icons';
	import { issue_icon_path } from '../issues/icons';
	import type { IssueOrPRTableItem, RepoRoute } from '$lib/types';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';

	let {
		type,
		table_item,
		repo_route,
		show_repo = false
	}: {
		type: 'issue' | 'pr';
		table_item?: IssueOrPRTableItem;
		repo_route?: RepoRoute;
		show_repo?: boolean;
	} = $props();

	let short_title = $derived.by(() => {
		const n = table_item ? table_item.title : 'Untitled';
		return n.length > 70 ? `${n.slice(0, 65)}...` : n;
	});
	let comments = 1;
</script>

<li class="flex p-2 pt-4 {table_item ? 'cursor-pointer hover:bg-base-200' : ''}">
	<!-- <figure class="p-4 pl-0 text-color-primary"> -->
	<!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
	{#if !table_item}
		<div class="skeleton h-5 w-5 flex-none pt-1"></div>
	{:else if table_item.status === proposal_status_open}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="h-5 w-5 flex-none fill-success pt-1"
		>
			{#if type === 'pr'}
				<path d={pr_icon_path.open_patch} />
			{:else if type === 'issue'}
				{#each issue_icon_path.open as p}
					<path d={p} />
				{/each}
			{/if}
		</svg>
	{:else if table_item.status === proposal_status_closed}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="h-5 w-5 flex-none fill-neutral-content pt-1"
		>
			{#if type === 'pr'}
				<path d={pr_icon_path.close} />
			{:else if type === 'issue'}
				{#each issue_icon_path.closed as p}
					<path d={p} />
				{/each}
			{/if}
		</svg>
	{:else if table_item.status === proposal_status_draft}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="h-5 w-5 flex-none fill-neutral-content pt-1"><path d={pr_icon_path.draft} /></svg
		>
	{:else if table_item.status === proposal_status_applied}
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="h-5 w-5 flex-none fill-primary pt-1"
		>
			{#if type === 'pr'}
				<path d={pr_icon_path.applied} />
			{:else if type === 'issue'}
				{#each issue_icon_path.resolved as p}
					<path d={p} />
				{/each}
			{/if}
		</svg>
	{/if}
	<a
		href="/{repo_route ? repo_route.s : 'TODO'}/{type}s/{nip19.noteEncode(table_item?.uuid ?? '') ||
			''}"
		class="ml-3 grow overflow-hidden text-xs text-neutral-content"
		class:pointer-events-none={!table_item}
	>
		{#if !table_item}
			<div class="skeleton h-5 w-60 flex-none pt-1"></div>
			<div class="skeleton mb-1 mt-3 h-3 w-40 flex-none"></div>
		{:else}
			<div class="text-sm text-base-content">
				{short_title}
			</div>
			<!-- <div class="text-xs text-neutral-content">
                {description}
            </div> -->
			<ul class="pt-2">
				{#if comments > 0}
					<li class="mr-3 inline align-middle">
						<!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="inline-block h-3 w-3 flex-none fill-base-content pt-0"
							viewBox="0 0 16 16"
							><path
								d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
							/></svg
						>
						{comments}
					</li>
				{/if}
				<li class="mr-3 inline">
					opened <FromNow unix_seconds={table_item.last_activity} />
				</li>
				<li class="inline">
					<UserHeader user={table_item.author} inline={true} size="xs" />
				</li>
				{#if show_repo && repo_route}
					<li class="ml-3 inline">
						<!-- <a class="link-primary z-10" href="/{repo_route.identifier}">
							{repo_route.identifier}
						</a> -->
					</li>
				{/if}
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
