<script lang="ts">
	import RepoPageContainer from '$lib/components/repo/RepoPageContainer.svelte';
	import type { RepoRoute, UserRoute } from '$lib/types';
	import type { Snippet } from 'svelte';

	let {
		data,
		children
	}: {
		data: {
			url: string;
			repo_route?: RepoRoute;
			user_route?: UserRoute;
			with_repo_sidebar: boolean;
			show_sidebar_on_mobile: boolean;
		};
		children: Snippet;
	} = $props();
</script>

{#if data.repo_route}
	<RepoPageContainer
		url={data.url}
		repo_route={data.repo_route}
		with_sidebar={data.with_repo_sidebar}
		show_sidebar_on_mobile={data.show_sidebar_on_mobile}
	>
		{@render children?.()}
	</RepoPageContainer>
{:else if data.user_route}
	{@render children?.()}
{:else}
	<div>404 not found</div>
{/if}
