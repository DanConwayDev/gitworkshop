<script lang="ts">
	import RepoPage from '$lib/components/repo/RepoPageContainer.svelte';
	import { repo_kind } from '$lib/kinds';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { RepoRef } from '$lib/types';
	import type { RepoRoute } from '$lib/types';
	import type { Snippet } from 'svelte';

	let { data, children }: { data: { repo_route: RepoRoute }; children: Snippet } = $props();

	let r = data.repo_route;

	let nip05_query = r.type === 'nip05' ? query_centre.fetchNip05(r.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);

	let a_ref: RepoRef | undefined = $derived.by(() => {
		if (r.type === 'nip05') {
			return nip05_result && nip05_result.user
				? (`${repo_kind}:${nip05_result.user.pubkey}:${r.identifier}` as RepoRef)
				: undefined;
		}
		return `${repo_kind}:${r.pubkey}:${r.identifier}` as RepoRef;
	});
</script>

<RepoPage {a_ref} identifier={r.identifier}>
	{@render children?.()}
</RepoPage>
{#if !a_ref && r.type === 'nip05'}
	{#if nip05_result?.loading}
		<div>loading user information for {r.nip05}</div>
	{:else}
		<div>could not find user information for {r.nip05}</div>
	{/if}
{/if}
