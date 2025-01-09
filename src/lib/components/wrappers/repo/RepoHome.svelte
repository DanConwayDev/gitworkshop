<script lang="ts">
	import Container from '$lib/components/wrappers/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre';
	import type { RepoRef } from '$lib/types';

	export let a_ref: RepoRef;
	let record = query_centre.fetchRepo(a_ref);
</script>

<Container>
	{#if $record}
		<h1>{$record.identifier}</h1>
	{:else}
		<p>Loading...</p>
	{/if}
</Container>
