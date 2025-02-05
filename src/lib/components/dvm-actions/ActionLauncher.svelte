<script lang="ts">
	import type { EventIdString, RepoRef } from '$lib/types';
	import ActionRequestForm from './ActionRequestForm.svelte';

	let { a_ref }: { a_ref: RepoRef } = $props();

	let submitted_job_id: EventIdString | undefined = $state();
</script>

{#if !submitted_job_id}
	<ActionRequestForm
		{a_ref}
		onsubmitted={(id) => {
			submitted_job_id = id;
		}}
	/>
{:else}
	TODO: show responses for {submitted_job_id}
{/if}
