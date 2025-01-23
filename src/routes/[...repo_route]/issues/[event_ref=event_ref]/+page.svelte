<script lang="ts">
	import type { PrOrIssueRouteData, RepoRef } from '$lib/types';
	import Compose from '$lib/components/compose/Compose.svelte';
	import PrOrIssueHeader from '$lib/components/prs-or-issues/PrOrIssueHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { neventOrNoteToHexId, repoRouteToARef } from '$lib/utils';
	import Container from '$lib/components/Container.svelte';
	import Thread from '$lib/components/event/Thread.svelte';
	import PrOrIssueDetails from '$lib/components/prs-or-issues/PrOrIssueDetails.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { repo_route, event_ref } = data;
	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));

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
