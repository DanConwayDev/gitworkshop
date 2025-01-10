<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import { naddrToRepoA } from '$lib/utils';

	export let data: { repo_naddr: string };
	let repo_naddr = data.repo_naddr;

	let a_ref = naddrToRepoA(repo_naddr);
</script>

{#if a_ref}
	<RepoPage {a_ref} />
{/if}
