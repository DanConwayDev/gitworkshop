<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapper from './EventWrapper.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	let { event, type }: { type: 'issue' | 'pr'; event: NostrEvent } = $props();

	let node = $derived(nostrEventToDocTree(event));
</script>

<EventWrapper {event} {type}>
	<ContentTree {node} />
</EventWrapper>
