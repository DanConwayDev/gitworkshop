<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import type { RepoRef } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { a_ref: RepoRef }; children: Snippet } = $props();

	let { a_ref } = data;
</script>

<RepoPage {a_ref}>
	{@render children?.()}
</RepoPage>
{#if !a_ref}
	<div>invalid npub in url</div>
{/if}
