<script lang="ts">
	import PrOrIssueByStatus from '$lib/components/prs-or-issues/PrOrIssueByStatus.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isRepoRoute, routeToRepoRef, type RepoRef } from '$lib/types';

	let repo_route = $derived(isRepoRoute(store.route) ? store.route : undefined);
	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));

	let issues_query = $derived(a_ref ? query_centre.fetchIssues(a_ref) : undefined);
	let issues = $derived(issues_query?.current ?? []);
</script>

{#if repo_route}
	<PrOrIssueByStatus type="issue" table_items={issues} {repo_route} />
{:else}
	<div>awaiting repo route information...</div>
{/if}
