<script lang="ts">
	import { routeToRepoRef, type PrOrIssueRouteData, type RepoRef } from '$lib/types';
	import PrOrIssueHeader from '$lib/components/prs-or-issues/PrOrIssueHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { neventOrNoteToHexId } from '$lib/utils';
	import Container from '$lib/components/Container.svelte';
	import store from '$lib/store.svelte';
	import PullRequestDiff from '$lib/components/prs/PullRequestDiff.svelte';

	let {
		data
	}: {
		data: PrOrIssueRouteData;
	} = $props();

	let { event_ref } = data;

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));

	// TODO - handle naddr
	let id = neventOrNoteToHexId(event_ref);
	let pr_query = $derived(id ? query_centre.fetchPr(id) : undefined);
	let table_item = $derived(pr_query?.current);
	$effect(() => {
		if (a_ref && id) query_centre.watchPrThread(a_ref, id);
	});
</script>

<PrOrIssueHeader {table_item} active_tab="files" />
<Container>
	{#if table_item}
		<PullRequestDiff {table_item} />
	{/if}
</Container>
