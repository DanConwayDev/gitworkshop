<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import EventWrapperLite from '../event/EventWrapperLite.svelte';
	import type { NEventAttributes } from 'nostr-editor';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import Issue from '../event/previews/Issue.svelte';

	let {
		nevent_attr,
		event,
		edit_mode
	}: {
		event?: NostrEvent;
		nevent_attr?: NEventAttributes;
		edit_mode?: { selected: boolean };
	} = $props();
	let e = $derived(
		event ? { event } : nevent_attr ? query_centre.fetchEvent(nevent_attr) : { event: undefined }
	);
</script>

<!-- {#if e.event}<EventCard type="issue" event={e.event} />{/if} -->
<div class="rounded-lg border border-base-300" class:border-neutral-content={edit_mode?.selected}>
	<EventWrapperLite {nevent_attr} event={e.event} disable_links={!!edit_mode}>
		{#if e.event?.kind === 1621}
			<Issue event={e.event} />
		{:else if e.event}
			kind: {e.event?.kind}
		{:else}
			loading event preview
		{/if}
	</EventWrapperLite>
</div>
