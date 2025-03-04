<script lang="ts">
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRef } from '$lib/types';
	import RecentRunItem from './RecentRunItem.svelte';

	let { a_ref }: { a_ref: RepoRef } = $props();

	let recent_runs = $derived(query_centre.watchRecentActionRequests(a_ref));
	let recent_runs_events = $derived(recent_runs.timeline);
</script>

{#if recent_runs_events.length === 0}
	no action runs found
{:else}
	{#each recent_runs_events as run_event}
		<RecentRunItem request_id={run_event.id} />
	{/each}
{/if}
