<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { eventToNip19, getRootNip19, getRootPointer } from '$lib/utils';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { isEventPointer } from 'applesauce-core/helpers';
	import { kindtoTextLabel } from '$lib/kinds';

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
		{#if root_event_query.event}
			a <a href={`/${root_nip19}`} class="link link-primary">
				{kindtoTextLabel(root_event_query.event.kind)}
			</a>
		{:else}
			<a href={`/${root_nip19}`} class="link link-primary"> this event </a>
		{/if}
	{:else}
		mentioned this in a <a href={`/${event_nip19}`} class="link link-primary"
			>{kindtoTextLabel(event.kind)}</a
		>
	{/if}
</EventWrapperLite>
