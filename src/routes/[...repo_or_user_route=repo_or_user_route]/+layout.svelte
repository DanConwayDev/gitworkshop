<script lang="ts">
	import { goto } from '$app/navigation';
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import {
		isRepoRoute,
		isRepoRouteData,
		isUserRouteData,
		isUserRoute,
		type RouteData,
	} from '$lib/types';
	import { onDestroy, onMount, type Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: RouteData;
		children: Snippet;
	} = $props();

	const updateStore = (data: RouteData) => {
		if (isRepoRouteData(data)) {
			if (!isRepoRoute(store.route) || store.route.s !== data.repo_route.s) {
				if (
					data.repo_route.type === 'nip05' &&
					(!store.route ||
						store.route.type !== 'nip05' ||
						data.repo_route.nip05 !== store.route.nip05)
				) {
					// fetchNip05 will update route_nip05_pubkey if response matches data.user_route.nip05
					query_centre.fetchNip05(data.repo_route.nip05);
				}
				store.route = data.repo_route;
			}
		} else if (isUserRouteData(data)) {
			if (!isUserRoute(store.route) || store.route.s !== data.user_route.s) {
				if (
					data.user_route.type === 'nip05' &&
					(!store.route ||
						store.route.type !== 'nip05' ||
						data.user_route.nip05 !== store.route.nip05)
				) {
					// fetchNip05 will update route_nip05_pubkey if response matches data.user_route.nip05
					query_centre.fetchNip05(data.user_route.nip05);
				}
				store.route = data.user_route;
			}
		} else if (store.route) {
			store.route = undefined;
		}

		if (
			store.route &&
			data.url &&
			data.url.endsWith(store.route.s) &&
			'a_ref' in store.route &&
			store.readme[store.route.a_ref]?.failed
		) {
			goto(`/${store.route.s}/prs`);
		}
	};
	updateStore(data);
	$effect(() => {
		updateStore(data);
	});
	onDestroy(() => {
		store.route = undefined;
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
