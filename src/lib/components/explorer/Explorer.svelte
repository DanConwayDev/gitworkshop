<script lang="ts">
	import { GitManager } from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { type RepoRef } from '$lib/types';
	import { onMount } from 'svelte';
	import FileViewer from './FileViewer.svelte';
	import type { FileEntry, Repository } from '$lib/types/git-manager';
	import { inMemoryRelayEvent } from '$lib/helpers.svelte';
	import { aRefToAddressPointer } from '$lib/utils';
	import type { AddressPointer } from 'nostr-tools/nip19';
	import { RepoStateKind } from '$lib/kinds';
	import FileExplorer from './FileExplorer.svelte';

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

	let repo_state_query = $derived(
		inMemoryRelayEvent({
			...aRefToAddressPointer(a_ref),
			kind: RepoStateKind
		} as AddressPointer)
	);
	let state_not_found = $state(false);
	onMount(() => {
		setTimeout(() => {
			if (!repo_state_query.event) {
				state_not_found = true;
			}
		}, 5000);
	});

	let refs = $derived(
		repo_state_query && repo_state_query.event
			? repo_state_query.event.tags
					.filter((t) => t[0] && t[0].startsWith('refs/') && t[0].indexOf('^{}') === -1)
					.sort((a, b) => a[0].localeCompare(b[0]))
			: []
	);

	let default_branch_or_tag = $derived.by(() => {
		if (repo_state_query && repo_state_query.event) {
			if (refs.map((t) => t[0]).includes('refs/heads/main')) return 'refs/heads/main';
			if (refs.map((t) => t[0]).includes('refs/heads/master')) return 'refs/heads/master';
			return refs.map((t) => t[0]).find((t) => t.includes('refs/heads/'));
		}
		return undefined;
	});
	$effect(() => {
		refs;
	});

	let git = new GitManager();

	// repo
	let repo: Repository | undefined = $state();
	let loading_repo_msg: undefined | string = $state();
	let loading_repo_error: undefined | string = $state();

	// selected
	let branch_in_path = $derived(
		!ref_and_path
			? undefined
			: repo?.branches
					.filter((branch) => ref_and_path.startsWith(branch))
					.reduce((longest, current) => {
						return current.length > longest.length ? current : longest;
					}, '')
	);
	let path = $derived(
		(ref_and_path ?? '')
			.replace(branch_in_path ?? '', '')
			.replace(/^\/+/, '') // Remove leading slashes
			.replace(/\/+$/, '')
	); // Remove trailing slashes
	let selected_branch = $derived(branch_in_path ?? repo?.defaultBranch);

	let path_is_dir: boolean | undefined = $state();

	const getParentDir = (path: string) => {
		// Split the path by '/' and remove the last segment
		const segments = path.split('/');
		segments.pop();
		return segments.join('/');
	};

	// directory
	let directory_structure: FileEntry[] | undefined = $state();
	let loading_directory: boolean = $state(true);
	let loading_directory_error: undefined | string = $state();

	// file
	let file_path = $derived(path_is_dir ? `${path}/README.md`.replace(/^\/+/, '') : path);
	let file_content: string | undefined = $state();
	let loading_file: boolean = $state(true);
	let loading_file_error: undefined | string = $state();
	$effect(() => {
		if (!repo) return;
		path_is_dir = undefined;
		let b = $state.snapshot(selected_branch);
		let f = $state.snapshot(path);

		// reset loading
		loading_directory = true;
		// directory_structure = undefined; - dont do this as it makes the UI flash
		loading_file = true;
		file_content = undefined;
		if (!selected_branch) {
			// stop loading and show error
			loading_file_error = undefined;
			loading_directory_error = undefined;
			if (!repo.defaultBranch) {
				loading_file = true;
				loading_directory = true;
			} else {
				loading_file_error = 'no branch selected';
				loading_directory_error = 'no branch selected';
			}
		} else {
			// try path as file
			loading_file_error = undefined;
			loading_file = true;
			loading_directory_error = undefined;
			loading_directory = true;
			git
				.getFileContent(a_ref, selected_branch, path)
				.then((c) => {
					if (b === selected_branch && f === path) {
						file_content = c;
						loading_file = false;
						loading_file_error = undefined;
						path_is_dir = false;
						scrollToAnchor();
						// path is file, get parent directory info
						git.getFileTree(a_ref, selected_branch, getParentDir(path)).then((a) => {
							if (b === selected_branch && f === path) {
								directory_structure = [...a];
								loading_directory = false;
								loading_directory_error = undefined;
							}
						});
					}
				})
				.catch((reason) => {
					if (b === selected_branch && f === path) {
						if (`${reason}`.includes('was anticipated to be a blob but it is a tree.')) {
							// path is directory, get parent directory info
							path_is_dir = true;
							git.getFileTree(a_ref, selected_branch, path).then((a) => {
								if (b === selected_branch && f === path) {
									directory_structure = [...a];
									loading_directory = false;
									loading_directory_error = undefined;
									if (a.some((e) => e.name === 'README.md')) {
										// try and get README.md
										git
											.getFileContent(
												a_ref,
												selected_branch,
												`${path}/README.md`.replace(/^\/+/, '') // remove leading slash
											)
											.then((c) => {
												loading_file = false;
												if (b === selected_branch && f === path) {
													scrollToAnchor();
													file_content = c;
													loading_file = false;
													loading_file_error = undefined;
												}
											});
									} else loading_file = false;
								}
							});
						} else {
							loading_file = false;
							file_content = undefined;
							if (
								`${reason}`.includes(
									'Error: Git readFile failed: Could not find file or directory found at "'
								)
							)
								loading_file_error = `"${path}" doesnt exist on branch "${selected_branch}"`;
							else loading_file_error = `error loading file: ${reason}`;
						}
					}
				});
		}
	});

	const cloneUrltoHttps = (clone_string: string): string => {
		let s = clone_string;
		// remove trailing slash
		if (s.endsWith('/')) s = s.substring(0, s.length - 1);
		// remove :// and anything before
		if (s.includes('://')) s = s.split('://')[1];
		// remove @ and anything before
		if (s.includes('@')) s = s.split('@')[1];
		// replace : with /
		s = s.replace(/\s|:[0-9]+/g, '');
		s = s.replace(':', '/');
		return `https://${s}`;
	};

	onMount(() => {
		loadRepo();
	});

	const loadRepo = async () => {
		try {
			loading_repo_error = undefined;
			loading_repo_msg = 'loading repository';
			const r = await git.loadRepositoryFromFilesystem(a_ref);
			if (r) {
				repo = r;
				loading_repo_msg = 'pulling repository data';
				await git.pullRepository(a_ref, repo.defaultBranch);
				loading_repo_msg = undefined;
				return;
			}
		} catch {
			/* empty */
		}
		outer: for (const proxy of [false, true]) {
			for (const clone_url of clone_urls.map(cloneUrltoHttps)) {
				try {
					git.clearCache();
					git = new GitManager();
				} catch {
					/*empty*/
				}
				try {
					path_is_dir = undefined;
					repo = undefined;
					loading_repo_error = undefined;
					loading_repo_msg = `loading from ${clone_url}`;
					repo = await git.cloneRepository(clone_url, a_ref, {
						singleBranch: true,
						proxy
					});
					loading_repo_error = undefined;
					loading_repo_msg = undefined;
					break outer;
				} catch {
					/*empty*/
				}
			}
		}
		if (!repo) {
			loading_repo_msg = undefined;
			loading_repo_error = `failed to load repo files from ${clone_urls.map(cloneUrltoHttps).join(' ')}`;
		}
	};
	function scrollToAnchor() {
		const anchor = document.getElementById('file-viewer');
		if (anchor && scroll_to_file) {
			anchor.scrollIntoView({ behavior: 'smooth' });
		}
	}
</script>

<!-- <div>TODO HEADER: {selected_branch}</div> -->

<FileExplorer
	path={path_is_dir ? path : getParentDir(path)}
	file_details={directory_structure}
	selected_file={file_path}
	error={loading_directory_error}
	base_url={`/${store.route?.s}/tree/${selected_branch}`}
/>
<div id="file-viewer">
	{#if loading_file || file_content || path_is_dir === false}
		<FileViewer path={file_path} content={file_content} />
	{/if}
</div>
