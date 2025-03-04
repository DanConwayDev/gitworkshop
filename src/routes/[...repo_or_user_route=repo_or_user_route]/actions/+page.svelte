<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import ActionLauncher from '$lib/components/dvm-actions/ActionLauncher.svelte';
	import RecentRunItem from '$lib/components/dvm-actions/RecentRunItem.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { routeToRepoRef, type RepoRef } from '$lib/types';

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));
	let recent_runs = $derived(
		a_ref ? query_centre.watchRecentActionRequests(a_ref) : { timeline: [] }
	);
	let recent_runs_events = $derived(recent_runs.timeline);

	let show_launcher = $state(false);
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
	{#if show_launcher}
		<div class="bg-base-200 pb-4">
			<Container>
				<ActionLauncher {a_ref} />
			</Container>
		</div>
	{/if}
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
				{#each recent_runs_events as run_event}
					<RecentRunItem request_id={run_event.id} />
				{/each}
			{/if}
		</Container>
	{/if}
{/if}
