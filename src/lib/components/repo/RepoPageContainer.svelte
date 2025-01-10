<script lang="ts">
	import RepoHeader from '$lib/components/repo/RepoHeader.svelte';
	import Container from '$lib/components/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre';
	import { repoTableItemDefaults, type RepoRef } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import RelayCheckReport from '../RelayCheckReport.svelte';
	import { isStrugglingToFindItem } from '$lib/type-helpers/general';

	let { a_ref }: { a_ref: RepoRef } = $props();
	let record_query = query_centre.fetchRepo(a_ref);
	let repo = $derived(record_query.current ?? repoTableItemDefaults(a_ref));
</script>

{#if repo}
	<RepoHeader {repo}></RepoHeader>
	<Container>
		{#if !repo.created_at}
			{#if !isStrugglingToFindItem(repo)}
				<h1>Searching for {repo.identifier} by <UserHeader user={repo.author} inline /></h1>
				<RelayCheckReport item={repo} />
			{/if}
		{:else}
			<h1>{repo.identifier}</h1>
		{/if}
	</Container>
{/if}
