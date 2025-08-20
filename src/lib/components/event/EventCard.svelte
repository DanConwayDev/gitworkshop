<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapper from './EventWrapper.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import type { IssueOrPRTableItem } from '$lib/types';
	import { DeletionKind, PatchKind, StatusKinds } from '$lib/kinds';
	import StatusCard from './StatusCard.svelte';
	import Patch from './Patch.svelte';
	import { onDestroy, onMount } from 'svelte';
	import EventWrapperLite from './EventWrapperLite.svelte';
	let {
		event,
		issue_or_pr_table_item,
		embedded = false,
		reactions = []
	}: {
		event: NostrEvent;
		issue_or_pr_table_item?: IssueOrPRTableItem;
		embedded?: boolean;
		reactions?: NostrEvent[];
	} = $props();

	let node = $derived(nostrEventToDocTree(event, true));

	let enable_truncation = true; // embedded;
	let content_container: HTMLDivElement;
	let show_more = $state(false);
	let is_truncated = $state(false);
	let resize_observer: ResizeObserver;

	const checkTruncation = () => {
		if (content_container) {
			is_truncated = content_container.scrollHeight > content_container.clientHeight;
		}
	};

	onMount(() => {
		resize_observer = new ResizeObserver(checkTruncation);
		if (content_container) {
			resize_observer.observe(content_container);
		}
	});

	onDestroy(() => {
		if (content_container) {
			resize_observer.unobserve(content_container);
		}
		resize_observer.disconnect();
	});

	$effect(() => {
		checkTruncation();
	});
</script>

<div class="relative">
	<div
		bind:this={content_container}
		class="overflow-hidden transition-all duration-300"
		class:max-h-[1250px]={!embedded && enable_truncation && !show_more}
		class:max-h-[400px]={embedded && !show_more}
	>
		{#if StatusKinds.includes(event.kind)}
			<StatusCard {event} {issue_or_pr_table_item} />
		{:else if PatchKind === event.kind}
			<EventWrapper {event} {issue_or_pr_table_item} {embedded} {reactions}>
				<Patch {event} />
			</EventWrapper>
		{:else if DeletionKind === event.kind}
			<EventWrapperLite {event}>deletion request from</EventWrapperLite>
		{:else}
			<EventWrapper {event} {issue_or_pr_table_item} {embedded} {reactions}>
				<ContentTree {node} />
			</EventWrapper>
		{/if}
	</div>

	{#if enable_truncation && is_truncated && !show_more}
		<div class="from-base-400 absolute inset-x-0 bottom-0 h-6 bg-linear-to-t to-transparent"></div>
		<div class="absolute bottom-0 left-1/2 mb-2 -translate-x-1/2 transform">
			<button class="btn btn-neutral btn-sm mt-2" onclick={() => (show_more = !show_more)}>
				{show_more ? 'Show Less' : 'Show More'}
			</button>
		</div>
	{/if}
</div>
