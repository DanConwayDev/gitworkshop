<script lang="ts">
	import RepoHeader from '$lib/components/repo/RepoHeader.svelte';
	import Container from '$lib/components/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import {
		repoTableItemDefaults,
		type RepoRef,
		type RepoRoute,
		type RepoTableItem
	} from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import RelayCheckReport from '../RelayCheckReport.svelte';
	import { isStrugglingToFindItem, lastSuccessfulCheck } from '$lib/type-helpers/general';
	import { network_status } from '$lib/internal_states.svelte';
	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import OfflineBanner from '../OfflineBanner.svelte';
	import type { Snippet } from 'svelte';
	import { repoRouteToARef } from '$lib/utils';

	let { repo_route, children }: { repo_route: RepoRoute; children: Snippet } = $props();

	let nip05_query =
		repo_route.type === 'nip05' ? query_centre.fetchNip05(repo_route.nip05) : undefined;
	let nip05_result = $derived(nip05_query ? nip05_query.current : undefined);
	let a_ref: RepoRef | undefined = $derived(repoRouteToARef(repo_route, nip05_result));

	let record_query = $derived(query_centre.fetchRepo(a_ref));
	let repo = $derived(record_query.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined));

	dayjs.extend(relativeTime);
	const getLastSuccessfulCheckTimeAgo = (repo: RepoTableItem) => {
		const lastCheckTimestamp = lastSuccessfulCheck(repo);
		return lastCheckTimestamp ? dayjs(lastCheckTimestamp * 1000).fromNow() : 'never';
	};
</script>

{#if repo && network_status.offline}
	<OfflineBanner msg={`repository data last refreshed ${getLastSuccessfulCheckTimeAgo(repo)}`} />
{/if}
<RepoHeader {repo} {repo_route}></RepoHeader>
<Container>
	{#if repo}
		{#if !repo.created_at}
			{#if !isStrugglingToFindItem(repo)}
				<h1>Searching for {repo.identifier} by <UserHeader user={repo.author} inline /></h1>
				<RelayCheckReport item={repo} />
			{/if}
		{:else}
			{@render children?.()}
		{/if}
	{:else if !a_ref && repo_route.type === 'nip05'}
		{#if nip05_result?.loading}
			<div>loading user information for {repo_route.nip05}</div>
		{:else}
			<div>could not find user information for {repo_route.nip05}</div>
		{/if}
	{/if}
</Container>
