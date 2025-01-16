<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import type { RepoRef } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { a_ref: RepoRef }; children: Snippet } = $props();

	let { a_ref } = data;
</script>

{#if a_ref}
	<RepoPage {a_ref}>
		{@render children?.()}
	</RepoPage>
{:else}
	<div>invalid repository reference in url</div>
{/if}
