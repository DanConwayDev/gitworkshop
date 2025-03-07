<script lang="ts">
	import { nip19 } from 'nostr-tools';
	import { type PrOrIssueRouteData } from '$lib/types';
	import { neventOrNoteToHexId } from '$lib/utils';
	import { createActionsRequestFilter } from '$lib/relay/filters/actions';
	import { inMemoryRelayEvent, inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import Container from '$lib/components/Container.svelte';
	import FromNow from '$lib/components/FromNow.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import { eventsToDVMActionSummary } from '$lib/types/dvm';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { event_ref } = data;

	// TODO - handle naddr
	let id = neventOrNoteToHexId(event_ref);

	let request_query = $derived.by(() => {
		try {
			const d = nip19.decode(event_ref);
			if (d.type === 'nevent') return inMemoryRelayEvent(d.data);
		} catch {
			return undefined;
		}
	});
	let request_event = $derived(request_query?.event);

	let responses_query = $derived(
		id ? inMemoryRelayTimeline(createActionsRequestFilter(id), () => [id]) : { timeline: [] }
	);
	let responses = $derived(responses_query.timeline);

	let summary = $derived(
		request_event ? eventsToDVMActionSummary(request_event, responses) : undefined
	);
	let status = $derived(summary ? summary.status : 'no_response');
	let status_text = $derived(summary ? summary.status_commentary : '');

	let short_status_text = $derived(
		status_text.length > 70 ? `${status_text.slice(0, 65)}...` : status_text
	);
</script>

{#if request_event}
	<div class="bg-base-200 py-3">
		<Container>
			<div>Status: {status} ({short_status_text})</div>
			<div>requested <FromNow unix_seconds={request_event.created_at} /></div>
		</Container>
	</div>
{:else}
	<NotFound404Page repo_header_on_page msg={`cannot find action request`} />
{/if}
