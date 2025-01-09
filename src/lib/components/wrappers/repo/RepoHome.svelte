<script lang="ts">
	import Container from '$lib/components/wrappers/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre';
	import { repoTableItemDefaults, type RepoRef } from '$lib/types';

	let { a_ref }: { a_ref: RepoRef } = $props();
	let record_query = query_centre.fetchRepo(a_ref);
	let record = $derived(record_query.current ?? repoTableItemDefaults(a_ref));
</script>

<Container>
	{#if record}
		<h1>{record.identifier}</h1>
	{:else}
		<p>Loading...</p>
	{/if}
</Container>
