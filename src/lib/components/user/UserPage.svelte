<script lang="ts">
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import type { UserRoute } from '$lib/types/user-route';
	import Container from '../Container.svelte';
	import ReposSummaryList from '../repo/ReposSummaryList.svelte';
	import UserHeader from './UserHeader.svelte';

	let { user_route }: { user_route: UserRoute } = $props();

	let nip05_query =
		user_route.type === 'nip05' ? query_centre.fetchNip05(user_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);

	let pubkey = $derived(
		user_route.type === 'npub' ? user_route.pubkey : (nip05_result?.user?.pubkey ?? undefined)
	);

	let repos_query = $derived(pubkey ? query_centre.fetchPubkeyRepos(pubkey) : undefined);
	let repos = $derived(repos_query?.current ?? []);
</script>

<Container>
	{#if pubkey}
		<div class="mt-12">
			<UserHeader user={pubkey} link_to_profile={false} size="full" />
			<div class="divider"></div>
			<ReposSummaryList title="Repositories" {repos} />
		</div>
	{:else}
		<div>loading...</div>
	{/if}
</Container>
