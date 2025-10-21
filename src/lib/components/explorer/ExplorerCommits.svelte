<script lang="ts">
	import git_manager from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { type RepoRef } from '$lib/types';
	import { onMount } from 'svelte';
	import {
		type CommitInfo,
		type GitServerState,
		type SelectedRefInfo
	} from '$lib/types/git-manager';
	import { inMemoryRelayEvent } from '$lib/helpers.svelte';
	import { aRefToAddressPointer } from '$lib/utils';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { RepoStateKind } from '$lib/kinds';
	import ExplorerLocator from './ExplorerLocator.svelte';
	import { getOveralGitServerStatus, refsToBranches, refsToTags } from '$lib/git-utils';
	import CommitsDetails from '../prs/CommitsDetails.svelte';

	let {
		a_ref,
		clone_urls,
		ref_and_path
	}: {
		a_ref: RepoRef;
		clone_urls: string[];
		ref_and_path?: string;
	} = $props();

	let identifier = $derived(a_ref ? a_ref.split(':')[2] : '');

	let nostr_state_query = $derived(
		inMemoryRelayEvent({
			...aRefToAddressPointer(a_ref),
			kind: RepoStateKind
		} as AddressPointer)
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

	onMount(() => {
		git_manager.refreshExplorer({});
		git_manager.listenForRecentCommitsInfos({ start_from_depth: 0, count: 20 });
		return () => {
			git_manager.stopListeningForRecentCommitsInfos({});
		};
	});

	$effect(() => {
		git_manager.updateRefAndPath({
			ref_and_path: $state.snapshot(ref_and_path)
		});
	});

	let git_refs: string[][] | undefined = $state();
	git_manager.addEventListener('stateUpdate', (e: Event) => {
		const customEvent = e as CustomEvent<string[][]>;
		git_refs = customEvent.detail;
	});

	let checked_out_ref: SelectedRefInfo | undefined = $state();
	git_manager.addEventListener('selectedRef', (e: Event) => {
		const customEvent = e as CustomEvent<SelectedRefInfo>;
		checked_out_ref = customEvent.detail;
	});

	let base_url = $derived(
		checked_out_ref
			? `/${store.route?.s}/tree/${checked_out_ref.ref.replace('refs/heads/', '')}`
			: `/${store.route?.s}`
	);

	let waited_1s_after_load = $state(false);

	let branches: string[] = $derived(refsToBranches(git_refs ?? []));
	let default_branch = $derived(
		git_refs?.find((r) => r[0] === 'refs/HEAD' || r[0] === 'HEAD')?.[1].replace('ref: ', '')
	);
	let tags: string[] = $derived(refsToTags(git_refs ?? []));

	let sub_filter = ['explorer'];
	let overal_server_status: GitServerState | undefined = $derived(
		getOveralGitServerStatus(store.git_log, ['explorer'], clone_urls)
	);

	let commits_infos: CommitInfo[] | undefined = $state();

	git_manager.addEventListener('recentCommitsInfos', (e: Event) => {
		const customEvent = e as CustomEvent<CommitInfo[]>;
		commits_infos = customEvent.detail;
	});

	let git_warning: string | undefined = $derived.by(() => {
		if (waited_1s_after_load && commits_infos) {
			if (!checked_out_ref)
				return undefined; // not found shown
			else if (!nostr_state)
				return 'No Nostr state found, displaying git server state. Ask the maintainer to start using ngit for the full nostr experience.';
			else if (checked_out_ref && !checked_out_ref.is_nostr_ref) {
				let nostr_state_ref = nostr_state.find(
					([ref]) =>
						checked_out_ref &&
						(ref == checked_out_ref.ref || ref == `refs/heads/${checked_out_ref.ref}`)
				);
				if (nostr_state_ref)
					return `"${checked_out_ref.ref}" expected at ${nostr_state_ref[1].slice(0, 8)} (nostr state) but showing ${checked_out_ref.commit_id.slice(0, 8)} (git server state) as data not available. Ask mainatainer to run \`ngit sync\`.`;
				else
					return `Ref "${checked_out_ref.ref}" not in Nostr state, displaying git server state. Ask mainatainer to run \`ngit sync\`.`;
			}
		}
	});
</script>

<ExplorerLocator
	{identifier}
	{base_url}
	path=""
	selected_ref_info={checked_out_ref}
	{default_branch}
	{branches}
	{tags}
	{clone_urls}
	{sub_filter}
	{git_warning}
	loading={!commits_infos}
/>

{#if waited_1s_after_load && !checked_out_ref && overal_server_status === 'fetched'}
	<div class="my-10 text-center">
		<h3 class="mb-6 text-2xl font-bold">Ref Not Found</h3>
		<p class="text-neutral-content mt-2 mb-4">
			cannot find ref <kbd class="kbd">{ref_and_path}</kbd> in this repository
		</p>
	</div>
{:else if !commits_infos}{:else}
	<CommitsDetails
		infos={commits_infos}
		loading={!commits_infos}
		{clone_urls}
		{sub_filter}
		grouped_by_date
	/>
{/if}
