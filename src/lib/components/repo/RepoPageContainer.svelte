<script lang="ts">
	import RepoHeader from '$lib/components/repo/RepoHeader.svelte';
	import Container from '$lib/components/Container.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import {
		repoTableItemDefaults,
		routeToRepoRef,
		type RepoRoute,
		type RepoTableItem
	} from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import RelayCheckReport from '../RelayCheckReport.svelte';
	import { isStrugglingToFindItem, lastSuccessfulCheck } from '$lib/type-helpers/general';
	import store, { network_status } from '$lib/store.svelte';
	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import OfflineBanner from '../OfflineBanner.svelte';
	import { onMount, type Snippet } from 'svelte';
	import RepoDetails from './RepoDetails.svelte';
	import { inMemoryRelayEvent } from '$lib/helpers.svelte';
	import { aRefToAddressPointer } from '$lib/utils';
	import { RepoStateKind } from '$lib/kinds';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import git_manager from '$lib/git-manager';

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

	let a_ref = $derived(routeToRepoRef(store.route));
	let hint_relays = $derived(store.route?.relays);

	let record_query = $derived(query_centre.fetchRepo(a_ref, hint_relays));
	let repo = $derived(record_query.current ?? (a_ref ? repoTableItemDefaults(a_ref) : undefined));

	dayjs.extend(relativeTime);
	const getLastSuccessfulCheckTimeAgo = (repo: RepoTableItem) => {
		const lastCheckTimestamp = lastSuccessfulCheck(repo);
		return lastCheckTimestamp ? dayjs(lastCheckTimestamp * 1000).fromNow() : 'never';
	};

	let nostr_state_query = $derived(
		a_ref
			? inMemoryRelayEvent({
					...aRefToAddressPointer(a_ref),
					kind: RepoStateKind
				} as AddressPointer)
			: undefined
	);
	let nostr_state = $derived(
		nostr_state_query && nostr_state_query.event
			? nostr_state_query.event.tags
					.filter(
						(t) =>
							t[0] &&
							(t[0].startsWith('refs/') || t[0].startsWith('HEAD')) &&
							t[0].indexOf('^{}') === -1
					)
					.sort((a, b) => a[0].localeCompare(b[0]))
			: undefined
	);
	let clone_urls = $derived(repo?.clone);

	function loadRepository() {
		if (a_ref && clone_urls && clone_urls.length > 0)
			git_manager.loadRepository(
				$state.snapshot(a_ref),
				$state.snapshot(clone_urls),
				$state.snapshot(nostr_state)
			);
	}
	onMount(() => {
		loadRepository();
	});
	$effect(() => {
		// required to trigger when a_ref changes
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		a_ref;
		loadRepository();
	});
	$effect(() => {
		git_manager.updateNostrState($state.snapshot(nostr_state));
	});
	$effect(() => {
		if (clone_urls) {
			loadRepository();
			git_manager.updateCloneUrls($state.snapshot(clone_urls));
		}
	});
</script>

{#if repo && network_status.offline}
	<OfflineBanner msg={`repository data last refreshed ${getLastSuccessfulCheckTimeAgo(repo)}`} />
{/if}
<RepoHeader {repo} {url}></RepoHeader>

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
		{#if store.route?.type === 'nip05' && store.route.loading}
			<div>loading user information for {repo_route.nip05}</div>
		{:else}
			<div>could not find user information for {repo_route.nip05}</div>
		{/if}
	{/if}
{/snippet}

{#if with_sidebar}
	<Container no_wrap_on_md>
		<div class="md:flex lg:mt-2">
			<div class="md:mt-2 md:mr-2 md:w-2/3">
				{@render contents()}
			</div>
			<div
				class:hidden={!show_sidebar_on_mobile}
				class=" border-base-400 rounded-lg border md:flex md:w-1/3 md:border-none"
			>
				<div class="border-base-400 bg-base-300 border-b px-6 py-3 md:hidden">
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
