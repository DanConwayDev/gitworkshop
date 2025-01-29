<script lang="ts">
	import { goto } from '$app/navigation';
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isRepoRouteData, isUserRouteData, type RouteData } from '$lib/types';
	import { onDestroy, onMount, type Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: RouteData;
		children: Snippet;
	} = $props();

	if (isRepoRouteData(data) || isUserRouteData(data)) {
		if (isRepoRouteData(data)) {
			store.route = data.repo_route;
		} else if (isUserRouteData(data)) {
			store.route = data.user_route;
		}
		if (store.route && store.route.type === 'nip05') {
			// fetchNip05 will update route_nip05_pubkey if response matches data.user_route.nip05
			query_centre.fetchNip05(store.route.nip05);
		}
	} else {
		store.route = undefined;
	}
	$effect(() => {
		if (
			store.route &&
			data.url &&
			data.url.endsWith(store.route.s) &&
			'a_ref' in store.route &&
			store.readme[store.route.a_ref]?.failed
		) {
			goto(`/${store.route.s}/prs`);
		}
	});
	onDestroy(() => {
		store.route = undefined;
	});
	onMount(() => {
		if (store.original_url_pref) {
			if (isRepoRouteData(data)) {
				store.original_url_pref = data.repo_route.type;
			} else if (isUserRouteData(data)) {
				store.original_url_pref = data.user_route.type;
			}
		}
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
