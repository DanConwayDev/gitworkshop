<script lang="ts">
	import type { NostrEvent } from 'nostr-tools';
	import EventWrapperLite from '../event/EventWrapperLite.svelte';
	import type { NAddrAttributes, NEventAttributes } from 'nostr-editor';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import Issue from '../event/previews/Issue.svelte';
	import { issue_kind, patch_kind, repo_kind } from '$lib/kinds';
	import Repo from '../event/previews/Repo.svelte';
	import Patch from '../event/previews/Patch.svelte';

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

<!-- {#if e.event}<EventCard type="issue" event={e.event} />{/if} -->
<div class="rounded-lg border border-base-300" class:border-neutral-content={edit_mode?.selected}>
	<EventWrapperLite {n_attr} event={e.event} disable_links={!!edit_mode}>
		{#if e.event?.kind === issue_kind}
			<Issue event={e.event} />
		{:else if e.event?.kind === patch_kind}
			<Patch event={e.event} />
		{:else if e.event?.kind === repo_kind}
			<Repo event={e.event} />
		{:else if e.event}
			kind: {e.event?.kind}
		{:else}
			loading event preview
		{/if}
	</EventWrapperLite>
</div>
