<script lang="ts">
	import {
		CommentKinds,
		status_kind_applied,
		status_kind_closed,
		status_kind_draft,
		status_kind_open
	} from '$lib/kinds';
	import { nip19 } from 'nostr-tools';
	import { pr_icon_path } from '../prs/icons';
	import { issue_icon_path } from '../issues/icons';
	import type { IssueOrPRTableItem, RepoRoute } from '$lib/types';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import UserAvatarGroup from '../user/UserAvatarGroup.svelte';

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
	let comments_refs = $derived(
		!table_item ? [] : table_item.quality_children.filter((r) => CommentKinds.includes(r.kind))
	);
	let commenters = $derived(
		new Set([...comments_refs.map((r) => r.pubkey).filter((p) => p !== table_item?.author)])
	);
</script>

<li class="flex p-2 @container {table_item ? 'cursor-pointer hover:bg-base-200' : ''}">
	<!-- <figure class="p-4 pl-0 text-color-primary"> -->
	<!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
	<div class="pt-2">
		{#if !table_item}
			<div class="skeleton h-5 w-5 flex-none pt-1"></div>
		{:else if table_item.status === status_kind_open}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-success pt-1"
			>
				<title>Open</title>
				{#if type === 'pr'}
					<path d={pr_icon_path.open_patch} />
				{:else if type === 'issue'}
					{#each issue_icon_path.open as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
		{:else if table_item.status === status_kind_closed}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-neutral-content pt-1"
			>
				<title>Closed</title>
				{#if type === 'pr'}
					<path d={pr_icon_path.close} />
				{:else if type === 'issue'}
					{#each issue_icon_path.closed as p}
						<path d={p} />
					{/each}
				{/if}
			</svg>
		{:else if table_item.status === status_kind_draft}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-neutral-content pt-1"
			>
				<title>Draft</title>
				<path d={pr_icon_path.draft} />
			</svg>
		{:else if table_item.status === status_kind_applied}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-primary pt-1"
			>
				<title
					>{#if type === 'pr'}Applied{:else if type === 'issue'}Resolved{/if}</title
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
	</div>
	<a
		href="/{repo_route ? repo_route.s : 'TODO'}/{type}s/{nip19.noteEncode(table_item?.uuid ?? '') ||
			''}"
		class="ml-3 flex grow overflow-hidden text-xs text-neutral-content"
		class:pointer-events-none={!table_item}
	>
		<div class="flex flex-grow pt-2">
			<div class="flex-grow">
				{#if !table_item}
					<div class="skeleton h-5 w-60 flex-none pt-1"></div>
					<div class="skeleton mb-1 mt-3 h-3 w-40 flex-none"></div>
				{:else}
					<div class="text-sm text-base-content">
						{short_title}
						{#each table_item.tags as tag}
							<div class="badge badge-secondary mx-1">{tag}</div>
						{/each}
					</div>
					<ul class="pt-2">
						<li class="mr-3 inline">
							active <FromNow unix_seconds={table_item.last_activity} />
						</li>
						<li class="inline">
							<UserHeader user={table_item.author} inline={true} size="xs" />
						</li>
						{#if comments_refs.length > 0}
							<li class="ml-2 inline align-middle opacity-50 @lg:hidden">
								<!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="inline-block h-3 w-3 flex-none fill-base-content pt-0"
									viewBox="0 0 16 16"
									><path
										d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
									/></svg
								>
								{comments_refs.length}
							</li>
						{/if}

						{#if show_repo && repo_route}
							<li class="ml-3 inline">
								<!-- <a class="link-primary z-10" href="/{repo_route.identifier}">
									{repo_route.identifier}
								</a> -->
							</li>
						{/if}
					</ul>
				{/if}
			</div>
		</div>
		<div class="hidden @lg:flex">
			<div class="flex items-center p-4 opacity-50">
				<UserAvatarGroup users={[...commenters]} />
			</div>
			<div class="flex items-center">
				{#if comments_refs.length > 0}
					<li class="mr-3 inline h-5 align-middle opacity-50">
						<!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="mr-1 inline-block h-4 w-4 flex-none fill-base-content"
							viewBox="0 0 16 16"
							><path
								d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
							/></svg
						>
						{comments_refs.length}
					</li>
				{/if}
			</div>
		</div>
	</a>
</li>
