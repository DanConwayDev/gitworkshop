<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapper from './EventWrapper.svelte';
	let { event, type }: { type: 'issue' | 'pr'; event: NostrEvent } = $props();
</script>

<EventWrapper {event} {type}>
	{event.content}
</EventWrapper>
