<script lang="ts">
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import { isRepoRouteData, isUserRouteData, type RouteData } from '$lib/types';
	import type { Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: RouteData;
		children: Snippet;
	} = $props();
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
