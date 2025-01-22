<script lang="ts">
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import type { RepoRouteData } from '$lib/types';
	import type { Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: RepoRouteData;
		children: Snippet;
	} = $props();
</script>

{#if data.repo_route}
	<RepoPageContainer
		url={data.url}
		repo_route={data.repo_route}
		with_sidebar={data.with_repo_sidebar || false}
		show_sidebar_on_mobile={data.show_sidebar_on_mobile || false}
	>
		{@render children?.()}
	</RepoPageContainer>
{:else if data.user_route}
	{@render children?.()}
{:else}
	<div>404 not found</div>
{/if}
