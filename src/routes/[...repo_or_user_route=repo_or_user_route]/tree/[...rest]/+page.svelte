<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import ContainerCenterPage from '$lib/components/ContainerCenterPage.svelte';
	import Explorer from '$lib/components/explorer/Explorer.svelte';
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';

	let { data }: { data: { params: { rest: string } } } = $props();

	let a_ref = $derived(store.route && 'a_ref' in store.route ? store.route.a_ref : undefined);
	let record_query = $derived(query_centre.fetchRepo(a_ref));
	let repo = $derived(record_query.current);
</script>

{#if store.route && 'identifier' in store.route}
	<Container>
		{#if a_ref && repo && repo.clone && repo.clone.length > 0}
			<Explorer {a_ref} ref_and_path={data.params.rest} clone_urls={repo.clone} />
		{:else}
			<div>loading</div>
		{/if}
	</Container>
{:else}
	<ContainerCenterPage>
		<NotFound404Page />
	</ContainerCenterPage>
{/if}
