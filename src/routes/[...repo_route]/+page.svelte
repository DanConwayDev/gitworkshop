<script lang="ts">
	import ContainerWithRepoDetailsSidebar from '$lib/components/repo/ContainerWithRepoDetailsSidebar.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRef, RepoRoute } from '$lib/types';
	import { repoRouteToARef } from '$lib/utils';

	let { data }: { data: { repo_route: RepoRoute } } = $props();

	let { repo_route } = data;
	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));
</script>

<ContainerWithRepoDetailsSidebar {repo_route} {a_ref}>
	<div>REPO PLACHOLDER</div>
</ContainerWithRepoDetailsSidebar>
