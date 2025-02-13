<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapper from './EventWrapper.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import type { IssueOrPRTableItem } from '$lib/types';
	import { patch_kind, status_kinds } from '$lib/kinds';
	import StatusCard from './StatusCard.svelte';
	import Patch from './Patch.svelte';
	import { onMount } from 'svelte';
	let {
		event,
		issue_or_pr_table_item,
		embedded = false,
	}: { event: NostrEvent; issue_or_pr_table_item?: IssueOrPRTableItem;
		embedded?: boolean;

	} = $props();

	let node = $derived(nostrEventToDocTree(event));

	let enable_truncation = true; // embedded;
	// let enable_truncation = embedded;
	let content_container: HTMLDivElement;
	let show_more = $state(false);
	let is_truncated = $state(false);
	// when event is loaded
	$effect(()=> {
		if (event && content_container.scrollHeight > content_container.clientHeight) {
			is_truncated = true;
		}
	})
</script>

<div class="relative">
	<div
		bind:this={content_container}
		class={`overflow-hidden transition-all duration-300`}
		class:max-h-[1000px]={enable_truncation && !show_more}
		class:max-h-[250px]={embedded && !show_more}
	>
		{#if status_kinds.includes(event.kind)}
			<StatusCard {event} {issue_or_pr_table_item} />
		{:else if patch_kind === event.kind}
			<EventWrapper {event} {issue_or_pr_table_item} {embedded}>
				<Patch {event} />
			</EventWrapper>
		{:else}
			<EventWrapper {event} {issue_or_pr_table_item} {embedded}>
				<ContentTree {node} />
			</EventWrapper>
		{/if}
	</div>

	{#if enable_truncation && is_truncated && !show_more}
	<div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-base-400  to-transparent"></div>
	<div class="absolute bottom-0 left-1/2 transform -translate-x-1/2 mb-2">
			<button
			class="mt-2 btn btn-sm btn-neutral"
			onclick={() => show_more = !show_more}
			>
			{show_more ? 'Show Less' : 'Show More'}
			</button>
		</div>
	{/if}

</div>
