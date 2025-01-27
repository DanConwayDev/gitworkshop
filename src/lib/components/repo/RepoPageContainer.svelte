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
	import { network_status } from '$lib/store.svelte';
	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import OfflineBanner from '../OfflineBanner.svelte';
	import { type Snippet } from 'svelte';
	import { repoRouteToARef } from '$lib/utils';
	import RepoDetails from './RepoDetails.svelte';

	let {
		url,
		repo_route,
		with_sidebar,
		show_sidebar_on_mobile,
		children
	}: {
		url: string;
		repo_route: RepoRoute;
		with_sidebar: boolean;
		show_sidebar_on_mobile: boolean;
		children: Snippet;
	} = $props();

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
<RepoHeader {repo} {repo_route} {url}></RepoHeader>

{#snippet contents()}
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
{/snippet}

{#if with_sidebar}
	<Container>
		<div class="mt-2 md:flex">
			<div class="md:mr-2 md:w-2/3">
				{@render contents()}
			</div>
			<div
				class:hidden={!show_sidebar_on_mobile}
				class=" rounded-lg border border-base-400 md:flex md:w-1/3 md:border-none"
			>
				<div class="border-b border-base-400 bg-base-300 px-6 py-3 md:hidden">
					<h4 class="">Repository Details</h4>
				</div>
				<div class="prose my-3 w-full px-6 md:ml-2 md:px-0">
					<RepoDetails {repo} {a_ref} {repo_route} />
				</div>
			</div>
		</div>
	</Container>
{:else}
	{@render contents()}
{/if}
