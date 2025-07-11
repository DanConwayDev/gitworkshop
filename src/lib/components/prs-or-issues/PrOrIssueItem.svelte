<script lang="ts">
	import {
		CommentKinds,
		StatusAppliedKind,
		StatusClosedKind,
		StatusDraftKind,
		StatusOpenKind
	} from '$lib/kinds';
	import { nip19 } from 'nostr-tools';
	import { pr_icon_path } from '../prs/icons';
	import { issue_icon_path } from '../issues/icons';
	import type { IssueOrPRTableItem, RepoRef, RepoRoute } from '$lib/types';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import UserAvatarGroup from '../user/UserAvatarGroup.svelte';
	import { RepoRouteStringCreator } from '$lib/helpers.svelte';

	let {
		type,
		table_item,
		repo_route,
		show_repo = false,
		is_notification = false,
		unread = undefined,
		mark_as_read = () => {},
		mark_as_unread = () => {}
	}: {
		type: 'issue' | 'pr';
		table_item?: IssueOrPRTableItem;
		repo_route?: RepoRoute;
		show_repo?: boolean;
		is_notification?: boolean;
		unread?: boolean;
		mark_as_read?: () => void;
		mark_as_unread?: () => void;
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

	let repo_route_c = $derived(
		repo_route ??
			(table_item && table_item.repos[0]
				? new RepoRouteStringCreator(table_item.repos[0] as RepoRef)
				: undefined)
	);
</script>

<li
	class:hover:bg-base-200={table_item}
	class="group hover:bg-neutral/25 @container flex p-2 {unread
		? 'border-x-secondary/30 bg-neutral/25 hover:bg-neutral/50'
		: ''}"
	class:cursor-pointer={table_item}
	class:border-l-1={unread}
	class:border-r-1={unread}
>
	<a
		href="{repo_route_c ? `/${repo_route_c.s}/${type}s` : ''}/{nip19.noteEncode(
			table_item?.uuid ?? ''
		) || ''}"
		class="text-neutral-content flex grow overflow-hidden text-xs"
		class:pointer-events-none={!table_item}
		onclick={mark_as_read}
	>
		{#if unread !== undefined}<div class="text-secondary w-4 pt-3 pr-1 text-xs">
				{#if unread}●{/if}
			</div>
		{/if}
		<!-- <figure class="p-4 pl-0 text-color-primary"> -->
		<!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
		<div class="pt-2">
			{#if !table_item}
				<div class="skeleton h-5 w-5 flex-none pt-1"></div>
			{:else if table_item.status === StatusOpenKind}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="fill-success h-5 w-5 flex-none pt-1"
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
			{:else if table_item.status === StatusClosedKind}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="fill-neutral-content h-5 w-5 flex-none pt-1"
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
			{:else if table_item.status === StatusDraftKind}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="fill-neutral-content h-5 w-5 flex-none pt-1"
				>
					<title>Draft</title>
					<path d={pr_icon_path.draft} />
				</svg>
			{:else if table_item.status === StatusAppliedKind}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="fill-primary h-5 w-5 flex-none pt-1"
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
		<div class="ml-3 flex grow pt-2">
			<div class="grow">
				{#if !table_item}
					<div class="skeleton h-5 w-60 flex-none pt-1"></div>
					<div class="skeleton mt-3 mb-1 h-3 w-40 flex-none"></div>
				{:else}
					<div class="text-base-content text-sm">
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
									class="fill-base-content inline-block h-3 w-3 flex-none pt-0"
									viewBox="0 0 16 16"
									><path
										d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
									/></svg
								>
								{comments_refs.length}
							</li>
						{/if}

						{#if show_repo && repo_route_c}
							<li class="ml-3 inline">
								<!-- svelte-ignore node_invalid_placement_ssr -->
								<a class="link-primary z-10" href="/{repo_route_c.s}">
									{repo_route_c.identifier}
								</a>
							</li>
						{/if}
					</ul>
				{/if}
			</div>
		</div>
		<div class="hidden @lg:flex {is_notification ? '@lg:group-hover:hidden' : ''}">
			<div class="flex items-center p-4 opacity-50">
				<UserAvatarGroup users={[...commenters]} />
			</div>
			<div class="flex items-center">
				{#if comments_refs.length > 0}
					<li class="mr-3 inline h-5 align-middle opacity-50">
						<!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="fill-base-content mr-1 inline-block h-4 w-4 flex-none"
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
	{#if is_notification}
		<div class="hidden self-center @lg:group-hover:block">
			{#if unread}
				<button class="btn btn-neutral btn-xs" onclick={mark_as_read}>mark as read</button>
			{:else}
				<button class="btn btn-neutral btn-xs" onclick={mark_as_unread}>mark as unread</button>
			{/if}
		</div>
	{/if}
</li>
