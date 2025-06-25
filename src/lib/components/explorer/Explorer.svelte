<script lang="ts">
	import { GitManager } from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { type RepoRef } from '$lib/types';
	import { onMount } from 'svelte';
	import FileViewer from './FileViewer.svelte';
	import type { Repository } from '$lib/types/git-manager';

	let { a_ref, clone_urls }: { a_ref: RepoRef; clone_urls: string[] } = $props();

	let git = new GitManager();

	// repo
	let repo: Repository | undefined = $state();
	let loading_repo_msg: undefined | string = $state();
	let loading_repo_error: undefined | string = $state();
	// refs
	let selected_branch: undefined | string = $state();

	// file
	let selected_file_path: string = $state('README.md');
	let file_content: string | undefined = $state();
	let loading_file: boolean = $state(true);
	let loading_file_error: undefined | string = $state();
	$effect(() => {
		if (!repo) return;
		loading_file = true;
		file_content = undefined;
		let b = $state.snapshot(selected_branch);
		let f = $state.snapshot(selected_file_path);
		if (!selected_branch) {
			loading_file_error = undefined;
			if (!repo.defaultBranch) loading_file = true;
			else loading_file_error = 'no branch selected';
		} else {
			loading_file_error = undefined;
			loading_file = true;
			git
				.getFileContent(a_ref, selected_branch, selected_file_path)
				.then((c) => {
					if (b === selected_branch && f === selected_file_path) {
						file_content = c;
						loading_file = false;
						loading_file_error = undefined;
					}
				})
				.catch((reason) => {
					if (b === selected_branch && f === selected_file_path) {
						loading_file = false;
						file_content = undefined;
						if (
							`${reason}`.includes(
								'Error: Git readFile failed: Could not find file or directory found at "'
							)
						)
							loading_file_error = `"${selected_file_path}" doesnt exist on branch "${selected_branch}"`;
						else loading_file_error = `error loading file: ${reason}`;
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
				selected_branch = repo.defaultBranch;
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
					repo = undefined;
					loading_repo_error = undefined;
					loading_repo_msg = `loading from ${clone_url}`;
					repo = await git.cloneRepository(clone_url, a_ref, {
						singleBranch: true,
						proxy
					});
					loading_repo_error = undefined;
					loading_repo_msg = undefined;
					selected_branch = repo.defaultBranch;
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
</script>

{#if !loading_file && (loading_repo_error || loading_file_error)}
	<div class="my-3 rounded-lg border border-base-400">
		<div class="border-b border-base-400 bg-base-300 px-6 py-3">
			<h4 class="">README.md</h4>
		</div>
		<div class="p-6">
			<div>{loading_repo_error || loading_file_error}</div>
		</div>
	</div>
{:else}
	<FileViewer path="README.md" content={file_content} />
{/if}
