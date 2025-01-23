<script lang="ts">
	import type { PrOrIssueRouteData, RepoRef } from '$lib/types';
	import Compose from '$lib/components/compose/Compose.svelte';
	import PrOrIssueHeader from '$lib/components/prs-or-issues/PrOrIssueHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { neventOrNoteToHexId, repoRouteToARef } from '$lib/utils';
	import Container from '$lib/components/Container.svelte';

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
	<Compose content="try pasting in a npub or nprofile" />
</Container>
{#each thread_events as event}
	<div>
		{event.content}
	</div>
{/each}
