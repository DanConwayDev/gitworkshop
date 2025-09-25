<script lang="ts">
	import { GitManager, type GitManagerLogEntry } from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { type RepoRef } from '$lib/types';
	import { onMount } from 'svelte';
	import FileViewer from './FileViewer.svelte';
	import type { FileEntry, SelectedPathInfo, SelectedRefInfo } from '$lib/types/git-manager';
	import { inMemoryRelayEvent } from '$lib/helpers.svelte';
	import { aRefToAddressPointer } from '$lib/utils';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { RepoStateKind } from '$lib/kinds';
	import FileExplorer from './FileExplorer.svelte';
	import ExplorerLocator from './ExplorerLocator.svelte';
	import { refsToBranches, refsToTags } from '$lib/git-utils';

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
		git.updateNostrState(nostr_state);
	});
	$effect(() => {
		git.updateCloneUrls(clone_urls);
	});

	$effect(() => {
		git.updateRefAndPath(ref_and_path ?? '');
	});

	let file_content: string | undefined = $state();
	git.addEventListener('fileContents', ((e: CustomEvent<string>) => {
		file_content = e.detail;
		scrollToAnchor();
	}) as EventListener);

	let path: string | undefined = $state();
	let path_exists: boolean | undefined = $state();
	let path_is_dir: boolean | undefined = $state();
	let file_path: string | undefined = $state();
	git.addEventListener('selectedPath', ((e: CustomEvent<SelectedPathInfo>) => {
		path_exists = e.detail.exists;
		path_is_dir = e.detail.path_is_dir;
		path = e.detail.path;
		if (e.detail.readme_path) {
			file_path = e.detail.readme_path;
		} else if (!path_is_dir) {
			file_path = e.detail.path;
		} else {
			file_path = undefined;
		}
	}) as EventListener);

	let git_refs: string[][] | undefined = $state();
	git.addEventListener('stateUpdate', ((e: CustomEvent<string[][]>) => {
		git_refs = e.detail;
	}) as EventListener);

	let checked_out_ref: SelectedRefInfo | undefined = $state();
	git.addEventListener('selectedRef', ((e: CustomEvent<SelectedRefInfo>) => {
		checked_out_ref = e.detail;
	}) as EventListener);

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
	git.addEventListener('directoryStructure', ((e: CustomEvent<FileEntry[]>) => {
		directory_structure = e.detail;
	}) as EventListener);

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

	let status: { msg?: string; remotes: { [key: string]: string | undefined } } = $state({
		remotes: {}
	});
	git.addEventListener('log', ((e: CustomEvent<GitManagerLogEntry>) => {
		if (e.detail.remote) status.remotes[e.detail.remote] = e.detail.msg;
		else status.msg = e.detail.msg;
		console.log(`${e.detail.remote ? `${e.detail.remote} ` : ''}${e.detail.msg}`);
	}) as EventListener);
</script>

<div>
	<div>overall: {status.msg ?? ''}</div>
	{#each Object.keys(status.remotes) as remote (remote)}
		<div>remote: {remote} {status.remotes[remote] ?? ''}</div>
	{/each}
</div>
<ExplorerLocator
	{identifier}
	{base_url}
	path={path ?? ''}
	selected_ref_info={checked_out_ref}
	{default_branch}
	{branches}
	{tags}
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
