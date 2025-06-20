<script lang="ts">
	import { stringToDocTree } from '$lib/doc_tree';
	import { GitManager } from '$lib/git-manager';
	import store from '$lib/store.svelte';
	import { readme_defaults, type RepoRef } from '$lib/types';
	import ContentTree from '../content-tree/ContentTree.svelte';

	let { a_ref, clone_urls }: { a_ref: RepoRef; clone_urls: string[] } = $props();

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

	const fetchReadme = async () => {
		store.readme[a_ref] = readme_defaults;
		let text: string | undefined;

		for (const clone_url of clone_urls.map(cloneUrltoHttps)) {
			try {
				let git = new GitManager();
				let repo = await git.cloneRepository(clone_url, a_ref, {
					depth: 1,
					singleBranch: true
				});

				let default_branch = repo.branches.includes(repo.defaultBranch)
					? repo.defaultBranch
					: repo.branches[0];

				text = await git.getFileContent(a_ref, default_branch, 'README.md');

				// If we reach this point, it means the clone and file retrieval succeeded
				break; // Exit the loop since we succeeded
			} catch {
				/* empty */
			}
		}
		store.readme[a_ref] = {
			md: text || '',
			loading: false,
			failed: !text
		};
	};

	if (!store.readme[a_ref]) {
		fetchReadme();
	}
</script>

<div class="my-3 rounded-lg border border-base-400">
	<div class="border-b border-base-400 bg-base-300 px-6 py-3">
		<h4 class="">README.md</h4>
	</div>
	<div class="p-6">
		{#if !store.readme[a_ref] || store.readme[a_ref].loading}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		{:else if store.readme[a_ref].failed}
			<div>failed to load readme from git server...</div>
		{:else}
			<article class="">
				<ContentTree node={stringToDocTree(store.readme[a_ref].md)} />
			</article>
		{/if}
	</div>
</div>
