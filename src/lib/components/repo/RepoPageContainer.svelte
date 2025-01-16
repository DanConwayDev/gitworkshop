<script lang="ts">
	import RepoHeader from '$lib/components/repo/RepoHeader.svelte';
	import Container from '$lib/components/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { repoTableItemDefaults, type RepoRef } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import RelayCheckReport from '../RelayCheckReport.svelte';
	import { isStrugglingToFindItem, lastSuccessfulCheck } from '$lib/type-helpers/general';
	import { network_status } from '$lib/internal_states.svelte';
	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import OfflineBanner from '../OfflineBanner.svelte';
	import type { Snippet } from 'svelte';

	let { a_ref, children }: { a_ref: RepoRef; children: Snippet } = $props();
	let record_query = query_centre.fetchRepo(a_ref);
	let repo = $derived(record_query.current ?? repoTableItemDefaults(a_ref));

	dayjs.extend(relativeTime);
	const getLastSuccessfulCheckTimeAgo = () => {
		const lastCheckTimestamp = lastSuccessfulCheck(repo);
		return lastCheckTimestamp ? dayjs(lastCheckTimestamp * 1000).fromNow() : 'never';
	};
</script>

{#if repo}
	{#if network_status.offline}
		<OfflineBanner msg={`repository data last refreshed ${getLastSuccessfulCheckTimeAgo()}`} />
	{/if}
	<RepoHeader {repo}></RepoHeader>
	<Container>
		{#if !repo.created_at}
			{#if !isStrugglingToFindItem(repo)}
				<h1>Searching for {repo.identifier} by <UserHeader user={repo.author} inline /></h1>
				<RelayCheckReport item={repo} />
			{/if}
		{:else}
			{@render children?.()}
		{/if}
	</Container>
{/if}
