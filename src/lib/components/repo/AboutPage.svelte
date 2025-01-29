<script>
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { repoTableItemDefaults, routeToRepoRef } from '$lib/types';
	import Readme from './Readme.svelte';

	let a_ref = $derived(routeToRepoRef(store.route));

	let record_query = $derived(query_centre.fetchRepo(a_ref));
	let repo = $derived(record_query.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined));
</script>

{#if a_ref && repo && repo.clone}
	<Readme {a_ref} clone_urls={repo.clone} />
{/if}
