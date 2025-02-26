<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { eventToNip19, getRootNip19, getRootPointer } from '$lib/utils';
	import { kindLabel } from '$lib/kind_labels';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { isEventPointer } from 'applesauce-core/helpers';

	let {
		event
	}: {
		event: NostrEvent;
	} = $props();

	let event_nip19 = $derived(eventToNip19(event));

	let root_nip19 = $derived(getRootNip19(event));
	let root_pointer = $derived(getRootPointer(event));
	let root_event_query = $derived(
		root_pointer && isEventPointer(root_pointer)
			? query_centre.fetchEvent(root_pointer)
			: { event: undefined }
	);
	// TODO: show a lite summary of root event, which is probably another issue or PR.
</script>

<EventWrapperLite {event} name_first>
	{#if root_nip19}
		mentioned this in <a href={`/${event_nip19}`} class="link link-primary">reply</a> to
		<a href={`/${root_nip19}`} class="link link-primary">
			{#if root_event_query.event}
				a {kindLabel(root_event_query.event.kind)}
			{:else}
				this event
			{/if}
		</a>
	{:else}
		mentioned this in a <a href={`/${event_nip19}`} class="link link-primary"
			>{kindLabel(event.kind)}</a
		>
	{/if}
</EventWrapperLite>
