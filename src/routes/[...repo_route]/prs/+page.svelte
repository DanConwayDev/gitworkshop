<script lang="ts">
	import PrOrIssueByStatus from '$lib/components/prs-or-issues/PrOrIssueByStatus.svelte';
	import ContainerWithRepoDetailsSidebar from '$lib/components/repo/ContainerWithRepoDetailsSidebar.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRoute, RepoRef } from '$lib/types';
	import { repoRouteToARef } from '$lib/utils';

	let { data }: { data: { repo_route: RepoRoute } } = $props();

	let { repo_route } = data;
	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));

	let prs_query = $derived(a_ref ? query_centre.fetchPrs(a_ref) : undefined);
	let prs = $derived(prs_query?.current ?? []);
</script>

<ContainerWithRepoDetailsSidebar {a_ref} {repo_route}>
	<PrOrIssueByStatus type="pr" table_items={prs} {repo_route} />
</ContainerWithRepoDetailsSidebar>
