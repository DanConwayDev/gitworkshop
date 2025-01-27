<script lang="ts">
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isRepoRouteData, isUserRouteData, type RouteData } from '$lib/types';
	import { onDestroy, type Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: RouteData;
		children: Snippet;
	} = $props();

	store.route_nip05_pubkey = undefined;
	store.route_nip05_pubkey_loading = false;
	if (isRepoRouteData(data)) {
		store.repo_route = data.repo_route;
		store.user_route = undefined;
		if (data.repo_route.type === 'nip05') {
			// fetchNip05 will update route_nip05_pubkey if response matches data.user_route.nip05
			query_centre.fetchNip05(data.repo_route.nip05);
		}
	} else if (isUserRouteData(data)) {
		store.user_route = data.user_route;
		store.repo_route = undefined;
		if (data.user_route.type === 'nip05') {
			// fetchNip05 will update route_nip05_pubkey if response matches data.user_route.nip05
			query_centre.fetchNip05(data.user_route.nip05);
		}
	} else {
		store.repo_route = undefined;
		store.user_route = undefined;
	}
	onDestroy(() => {
		store.repo_route = undefined;
		store.user_route = undefined;
		store.route_nip05_pubkey = undefined;
	});
</script>

{#if isRepoRouteData(data)}
	<RepoPageContainer
		url={data.url}
		repo_route={data.repo_route}
		with_sidebar={data.with_repo_sidebar || false}
		show_sidebar_on_mobile={data.show_sidebar_on_mobile || false}
	>
		{@render children?.()}
	</RepoPageContainer>
{:else if isUserRouteData(data)}
	{@render children?.()}
{:else}
	<div>404 not found</div>
{/if}
