<script lang="ts">
	import PrOrIssueByStatus from '$lib/components/prs-or-issues/PrOrIssueByStatus.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isRepoRoute, routeToRepoRef, type RepoRef } from '$lib/types';

	let repo_route = $derived(isRepoRoute(store.route) ? store.route : undefined);
	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));

	let prs_query = $derived(a_ref ? query_centre.fetchPrs(a_ref) : undefined);
	let prs = $derived(prs_query?.current ?? []);
</script>

{#if repo_route}
	<PrOrIssueByStatus type="pr" table_items={prs} {repo_route} />
{:else}
	<div>awaiting repo route information...</div>
{/if}
