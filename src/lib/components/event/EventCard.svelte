<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapper from './EventWrapper.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import type { IssueOrPRTableItem } from '$lib/types';
	import { status_kinds } from '$lib/kinds';
	import StatusCard from './StatusCard.svelte';
	let {
		event,
		issue_or_pr_table_item
	}: { event: NostrEvent; issue_or_pr_table_item?: IssueOrPRTableItem } = $props();

	let node = $derived(nostrEventToDocTree(event));
</script>

{#if status_kinds.includes(event.kind)}
	<StatusCard {event} {issue_or_pr_table_item} />
{:else}
	<EventWrapper {event} {issue_or_pr_table_item}>
		<ContentTree {node} />
	</EventWrapper>
{/if}
