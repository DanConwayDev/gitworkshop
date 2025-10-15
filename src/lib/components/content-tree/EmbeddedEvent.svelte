<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import EventWrapperLite from '../event/EventWrapperLite.svelte';
	import type { NAddrAttributes, NEventAttributes } from 'nostr-editor';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import Issue from '../event/previews/Issue.svelte';
	import { IssueKind, PatchKind, PrKind, RepoAnnKind } from '$lib/kinds';
	import Repo from '../event/previews/Repo.svelte';
	import Patch from '../event/previews/Patch.svelte';
	import EventCard from '../event/EventCard.svelte';
	import { isEvent } from 'applesauce-core/helpers';

	let {
		n_attr,
		event,
		edit_mode
	}: {
		event?: NostrEvent;
		n_attr?: NEventAttributes | NAddrAttributes;
		edit_mode?: { selected: boolean };
	} = $props();
	let e = $derived(
		event ? { event } : n_attr ? query_centre.fetchEvent(n_attr) : { event: undefined }
	);
</script>

<div
	class="border-base-300 bg-base-200 rounded-lg border"
	class:border-neutral-content={edit_mode?.selected}
>
	{#if edit_mode || !e.event || !isEvent(e.event) || [IssueKind, PatchKind, PrKind, RepoAnnKind].includes(e.event?.kind)}
		<EventWrapperLite {n_attr} event={e.event} disable_links={!!edit_mode}>
			{#if e.event?.kind === IssueKind}
				<Issue event={e.event} />
			{:else if e.event?.kind === PatchKind}
				<Patch event={e.event} />
			{:else if e.event?.kind === PrKind}
				<Patch event={e.event} />
			{:else if e.event?.kind === RepoAnnKind}
				<Repo event={e.event} />
			{:else if e.event}
				kind: {e.event?.kind}
			{:else}
				loading event preview
			{/if}
		</EventWrapperLite>
	{:else}
		<EventCard event={e.event} embedded={true} />
	{/if}
</div>
