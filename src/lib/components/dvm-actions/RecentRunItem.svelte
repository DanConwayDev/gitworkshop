<script lang="ts">
	import { inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import { createActionsRequestFilter } from '$lib/relay/filters/actions';
	import { eventToNip19 } from '$lib/utils';
	import type { NostrEvent } from 'nostr-tools/core';
	import { issue_icon_path } from '../issues/icons';
	import store from '$lib/store.svelte';
	import { isRepoRoute } from '$lib/types';
	import { eventsToDVMActionSummary } from '$lib/types/dvm';

	let { request_event }: { request_event: NostrEvent } = $props();

	let request_id = $derived(request_event ? request_event.id : undefined);
	let responses_query = $derived(
		request_id
			? inMemoryRelayTimeline(createActionsRequestFilter(request_id), () => [request_id])
			: { timeline: [] }
	);
	let responses = $derived(responses_query.timeline);
	let summary = $derived(eventsToDVMActionSummary(request_event, responses));
	let status = $derived(summary.status);
	let status_text = $derived(summary.status_commentary);

	let short_status_text = $derived(
		status_text.length > 70 ? `${status_text.slice(0, 65)}...` : status_text
	);

	let repo_route = $derived(isRepoRoute(store.route) ? store.route : undefined);

	let nevent = $derived(eventToNip19(request_event));
</script>

<li
	class="flex p-2 @container {status !== 'pending_response' && status !== 'no_response'
		? 'cursor-pointer hover:bg-base-200'
		: ''}"
>
	<!-- <figure class="p-4 pl-0 text-color-primary"> -->
	<!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
	<div class="pt-2">
		{#if status === 'pending_response'}
			<div class="skeleton h-5 w-5 flex-none pt-1"></div>
		{:else if status === 'success'}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-success pt-1"
			>
				<title>Success</title>
				{#each issue_icon_path.open as p}
					<path d={p} />
				{/each}
			</svg>
		{:else if status === 'payment_issue'}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-5 w-5 flex-none fill-error pt-1"
			>
				<title>Payment Issue</title>
				{#each issue_icon_path.closed as p}
					<path d={p} />
				{/each}
			</svg>
		{/if}
	</div>
	<a
		href={`/${repo_route ? repo_route.s : 'TODO'}/actions/${nevent}`}
		class="ml-3 flex grow overflow-hidden text-xs text-neutral-content"
	>
		<div class="flex flex-grow pt-2">
			<div class="flex-grow">
				<div class="text-sm text-base-content">
					{short_status_text}
					<!-- {#each table_item.tags as tag}
						<div class="badge badge-secondary mx-1">{tag}</div>
					{/each} -->
				</div>
				<ul class="pt-2">
					{#if status === 'payment_issue'}
						<li class="mr-3 inline text-error">payment issue</li>
					{/if}

					<!-- <li class="mr-3 inline">
						active <FromNow unix_seconds={table_item.last_activity} />
					</li>
					<li class="inline">
						<UserHeader user={table_item.author} inline={true} size="xs" />
					</li> -->
				</ul>
			</div>
		</div>
		<div class="hidden @lg:flex">
			<div class="flex items-center p-4 opacity-50">
				<!-- <UserAvatarGroup users={[...commenters]} /> -->
			</div>
			<div class="flex items-center"></div>
		</div>
	</a>
</li>
