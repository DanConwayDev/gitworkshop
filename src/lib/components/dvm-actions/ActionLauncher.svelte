<script lang="ts">
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { EventIdString, RepoRef } from '$lib/types';
	import ActionRequestForm from './ActionRequestForm.svelte';

	let { a_ref }: { a_ref: RepoRef } = $props();

	let submitted_job_id: EventIdString | undefined = $state();

	let new_repo_dvm_events_query = query_centre.listenForActions(a_ref);
	let new_repo_dvm_events = $derived(new_repo_dvm_events_query.timeline);

	let offer_events = $derived(
		submitted_job_id
			? new_repo_dvm_events.filter((e) => e.tags.some((t) => t[1] && t[1] === submitted_job_id))
			: []
	);
</script>

{#if !submitted_job_id}
	<ActionRequestForm
		{a_ref}
		onsubmitted={(id) => {
			submitted_job_id = id;
		}}
	/>
{:else}
	TODO: show {offer_events.length} responses for {submitted_job_id}
{/if}
