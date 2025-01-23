<script lang="ts">
	import PrOrIssueByStatus from '$lib/components/prs-or-issues/PrOrIssueByStatus.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRef, RepoRouteData } from '$lib/types';
	import { repoRouteToARef } from '$lib/utils';

	let { data }: { data: RepoRouteData } = $props();

	let { repo_route } = data;
	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));

	let issues_query = $derived(a_ref ? query_centre.fetchIssues(a_ref) : undefined);
	let issues = $derived(issues_query?.current ?? []);
</script>

<PrOrIssueByStatus type="issue" table_items={issues} {repo_route} />
