<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import type { RepoRoute } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { repo_route?: RepoRoute }; children: Snippet } = $props();
</script>

{#if data.repo_route}
	<RepoPage repo_route={data.repo_route}>
		{@render children?.()}
	</RepoPage>
{:else}
	<div>404 not found</div>
{/if}
