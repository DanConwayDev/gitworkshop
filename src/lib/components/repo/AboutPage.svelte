<script>
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { repoTableItemDefaults, routeToRepoRef } from '$lib/types';
	import Explorer from '../explorer/Explorer.svelte';

	let a_ref = $derived(routeToRepoRef(store.route));
	let hint_relays = $derived(store.route?.relays);
	let record_query = $derived(query_centre.fetchRepo(a_ref, hint_relays));
	let repo = $derived(record_query.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined));
</script>

{#if a_ref && repo && repo.clone}
	<Explorer {a_ref} clone_urls={repo.clone} scroll_to_file={false} />
{/if}
