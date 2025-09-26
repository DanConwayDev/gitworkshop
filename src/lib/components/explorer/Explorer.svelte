<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { GitManager } from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { type RepoRef } from '$lib/types';
	import { onMount } from 'svelte';
	import FileViewer from './FileViewer.svelte';
	import {
		isGitManagerLogEntryServer,
		type FileEntry,
		type GitManagerLogEntry,
		type GitServerState,
		type GitServerStatus,
		type SelectedPathInfo,
		type SelectedRefInfo
	} from '$lib/types/git-manager';
	import { inMemoryRelayEvent } from '$lib/helpers.svelte';
	import { aRefToAddressPointer } from '$lib/utils';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { RepoStateKind } from '$lib/kinds';
	import FileExplorer from './FileExplorer.svelte';
	import ExplorerLocator from './ExplorerLocator.svelte';
	import { refsToBranches, refsToTags, remoteNameToShortName } from '$lib/git-utils';

	let {
		a_ref,
		clone_urls,
		ref_and_path,
		scroll_to_file = true
	}: {
		a_ref: RepoRef;
		clone_urls: string[];
		ref_and_path?: string;
		scroll_to_file?: boolean;
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

	let git = new GitManager();
	function loadRepository() {
		git.loadRepository(a_ref, clone_urls, nostr_state, ref_and_path);
	}
	let waited_1s = $state(false);
	onMount(() => {
		loadRepository();
		setTimeout(() => {
			waited_1s = true;
		}, 1000);
	});
	$effect(() => {
		// required to trigger when a_ref changes
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		a_ref;
		loadRepository();
	});
	$effect(() => {
		git.updateNostrState(nostr_state);
	});
	$effect(() => {
		git.updateCloneUrls(clone_urls);
	});

	$effect(() => {
		git.updateRefAndPath(ref_and_path ?? '');
	});

	let file_content: string | undefined = $state();
	git.addEventListener('fileContents', (e: Event) => {
		const customEvent = e as CustomEvent<string>;
		file_content = customEvent.detail;
		scrollToAnchor();
	});

	let path: string | undefined = $state();
	let path_exists: boolean | undefined = $state();
	let path_is_dir: boolean | undefined = $state();
	let file_path: string | undefined = $state();
	git.addEventListener('selectedPath', (e: Event) => {
		const customEvent = e as CustomEvent<SelectedPathInfo>;
		path_exists = customEvent.detail.exists;
		path_is_dir = customEvent.detail.path_is_dir;
		path = customEvent.detail.path;
		if (customEvent.detail.readme_path) {
			file_path = customEvent.detail.readme_path;
		} else if (!path_is_dir) {
			file_path = customEvent.detail.path;
		} else {
			file_path = undefined;
		}
	});

	let git_refs: string[][] | undefined = $state();
	git.addEventListener('stateUpdate', (e: Event) => {
		const customEvent = e as CustomEvent<string[][]>;
		git_refs = customEvent.detail;
	});

	let checked_out_ref: SelectedRefInfo | undefined = $state();
	git.addEventListener('selectedRef', (e: Event) => {
		const customEvent = e as CustomEvent<SelectedRefInfo>;
		checked_out_ref = customEvent.detail;
	});

	let base_url = $derived(
		`/${store.route?.s}/tree/${checked_out_ref?.ref.replace('refs/heads/', '')}`
	);

	const getParentDir = (path: string) => {
		// Split the path by '/' and remove the last segment
		const segments = path.split('/');
		segments.pop();
		return segments.join('/');
	};

	// directory
	let directory_structure: FileEntry[] | undefined = $state();
	git.addEventListener('directoryStructure', (e: Event) => {
		const customEvent = e as CustomEvent<FileEntry[]>;
		directory_structure = customEvent.detail;
	});

	let branches: string[] = $derived(refsToBranches(git_refs ?? []));
	let default_branch = $derived(
		git_refs?.find((r) => r[0] === 'refs/HEAD' || r[0] === 'HEAD')?.[1].replace('ref: ', '')
	);
	let tags: string[] = $derived(refsToTags(git_refs ?? []));

	function scrollToAnchor() {
		const anchor = document.getElementById('file-viewer');
		if (anchor && scroll_to_file) {
			anchor.scrollIntoView({ behavior: 'smooth' });
		}
	}

	let server_status: SvelteMap<string, GitServerStatus> = new SvelteMap();
	let overal_server_status: GitServerState | undefined = $derived.by(() => {
		if (server_status.entries().some((e) => e[1].state === 'connected')) return 'connected';
		if (server_status.entries().some((e) => e[1].state === 'fetching')) return 'fetching';
		if (server_status.entries().some((e) => e[1].state === 'connecting')) return 'connecting';
		if (server_status.entries().some((e) => e[1].state === 'failed')) return 'failed';
	});
	git.addEventListener('log', (e: Event) => {
		const customEvent = e as CustomEvent<GitManagerLogEntry>;
		if (isGitManagerLogEntryServer(customEvent.detail)) {
			let status = server_status.get(customEvent.detail.remote) || {
				short_name: remoteNameToShortName(customEvent.detail.remote, clone_urls),
				state: 'connecting',
				with_proxy: false
			};
			if (customEvent.detail.msg?.includes('proxy')) status.with_proxy = true;
			server_status.set(customEvent.detail.remote, {
				...status,
				state: customEvent.detail.state,
				msg: customEvent.detail.msg
			});
		} else {
			// not showing any global git logging
		}
	});
	let git_warning: string | undefined = $derived.by(() => {
		if (waited_1s) {
			if (!checked_out_ref && overal_server_status === 'connected')
				return `ref not found${nostr_state ? ' in nostr or connected git servers' : ''}`;
			else if (!nostr_state)
				// should this be a warning? maybe just an indicator?
				return 'cannot find git state from nostr, using state from listed git servers';
			else if (checked_out_ref && !checked_out_ref.is_nostr_ref) {
				if (nostr_state.some(([ref]) => checked_out_ref && ref === checked_out_ref.ref))
					return 'cannot find git data for this ref in nostr state, showing ref from git server instead';
				else
					return 'selected ref not in nostr state but is in state of a listed git server so showing that instead';
			}
		}
	});
</script>

<ExplorerLocator
	{identifier}
	{base_url}
	path={path ?? ''}
	selected_ref_info={checked_out_ref}
	{default_branch}
	{branches}
	{tags}
	{server_status}
	{git_warning}
/>

{#if path_exists !== undefined && !path_exists}
	<div class="my-10 text-center">
		<h1 class="mb-2 text-9xl font-bold">¯\_(ツ)_/¯</h1>
		<h3 class="mb-4 text-2xl font-bold">Not Found</h3>
		<p class="text-neutral-content mt-2 mb-4">path does not exist in at this ref</p>
	</div>
{:else}
	<FileExplorer
		loading_msg={undefined}
		path={path_is_dir ? (path ?? '') : getParentDir(path ?? '')}
		file_details={directory_structure}
		selected_file={file_path}
		error={undefined}
		{base_url}
	/>
	<div id="file-viewer">
		{#if file_content || file_path}
			<FileViewer path={file_path ?? ''} content={file_content} />
		{/if}
	</div>
{/if}
