<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import { repo_kind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { Nip05Address, RepoRef } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { nip05: Nip05Address; identifier: string }; children: Snippet } =
		$props();

	let nip05_query = query_centre.fetchNip05(data.nip05);
	let nip05_result = $derived(nip05_query.current);
	let a_ref: RepoRef | undefined = $derived(
		nip05_result && nip05_result.user
			? (`${repo_kind}:${nip05_result.user.pubkey}:${data.identifier}` as RepoRef)
			: undefined
	);
</script>

<RepoPage {a_ref} identifier={data.identifier}>
	{@render children?.()}
</RepoPage>
{#if !a_ref}
	{#if nip05_result?.loading}
		<div>loading user information for {data.nip05}</div>
	{:else}
		<div>could not find user information for {data.nip05}</div>
	{/if}
{/if}
