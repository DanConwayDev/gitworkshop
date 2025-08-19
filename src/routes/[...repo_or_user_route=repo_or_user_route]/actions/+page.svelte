<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import ActionRequestForm from '$lib/components/dvm-actions/ActionRequestForm.svelte';
	import RecentRunItem from '$lib/components/dvm-actions/RecentRunItem.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { routeToRepoRef, type EventIdString, type RepoRef } from '$lib/types';

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));
	let recent_runs = $derived(
		a_ref ? query_centre.watchRecentActionRequests(a_ref) : { timeline: [] }
	);
	let recent_runs_events = $derived(recent_runs.timeline);

	let show_launcher = $state(true);
	let submitted_job_id: EventIdString | undefined = $state(undefined);
</script>

{#snippet noneFound()}
	no runs found
	{#if !show_launcher}
		<button
			class="btn btn-success mt-6"
			onclick={() => {
				show_launcher = true;
			}}>Launch Action</button
		>
	{/if}
{/snippet}

{#if a_ref}
	<div class="bg-base-200 pb-4">
		<Container>
			{#if show_launcher}
				<ActionRequestForm
					{a_ref}
					onsubmitted={(id) => {
						submitted_job_id = id;
						show_launcher = false;
					}}
				/>
			{:else}
				launched {submitted_job_id}
				<button
					class="btn btn-success btn-sm mt-6"
					onclick={() => {
						show_launcher = true;
					}}>Launch Another</button
				>
			{/if}
		</Container>
	</div>
	{#if recent_runs_events.length === 0 && !show_launcher}
		<ContainerCenterPage repo_header_on_page>
			{@render noneFound()}
		</ContainerCenterPage>
	{:else}
		<Container>
			{#if recent_runs_events.length === 0}
				<div class="mt-3 flex h-full flex-col items-center justify-center">
					<p class="text-center">
						{@render noneFound()}
					</p>
				</div>
			{:else}
				<ul class="divide-base-400 border-base-400 divide-y border">
					{#each recent_runs_events as run_event (run_event.id)}
						<RecentRunItem request_event={run_event} />
					{/each}
				</ul>
			{/if}
		</Container>
	{/if}
{/if}
