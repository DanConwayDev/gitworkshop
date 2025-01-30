<script lang="ts">
	import { routeToRepoRef, type PrOrIssueRouteData, type RepoRef } from '$lib/types';
	import Compose from '$lib/components/compose/Compose.svelte';
	import PrOrIssueHeader from '$lib/components/prs-or-issues/PrOrIssueHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { neventOrNoteToHexId } from '$lib/utils';
	import Container from '$lib/components/Container.svelte';
	import Thread from '$lib/components/event/Thread.svelte';
	import PrOrIssueDetails from '$lib/components/prs-or-issues/PrOrIssueDetails.svelte';
	import store from '$lib/store.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { event_ref } = data;

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));

	// TODO - handle naddr
	let id = neventOrNoteToHexId(event_ref);
	let issue_query = $derived(id ? query_centre.fetchIssue(id) : undefined);
	let table_item = $derived(issue_query?.current);

	let thread_query = $derived(a_ref && id ? query_centre.fetchIssueThread(a_ref, id) : undefined);
	let thread_events = $derived(thread_query?.timeline ?? []);
</script>

<PrOrIssueHeader type="issue" {table_item} />
<Container>
	{#if table_item}
		<div class="mx-auto max-w-6xl lg:flex">
			<div class="md:mr-2 lg:w-2/3">
				<div class="max-w-4xl">
					<Thread
						type="issue"
						event={table_item.event}
						issue_or_pr_table_item={table_item}
						replies={thread_events}
						show_compose={false}
					/>
				</div>
			</div>
			<div class="prose ml-2 hidden w-1/3 lg:flex">
				<PrOrIssueDetails type="issue" {table_item} />
			</div>
		</div>
	{/if}
</Container>

<Container>
	<Compose content="try pasting in a npub or nprofile" />
</Container>
