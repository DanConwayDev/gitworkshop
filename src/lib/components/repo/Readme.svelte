<script lang="ts">
	import { stringToDocTree } from '$lib/doc_tree';
	import store from '$lib/store.svelte';
	import { readme_defaults, type RepoRef } from '$lib/types';
	import { cloneArrayToReadMeUrls } from '$lib/types/readme';
	import ContentTree from '../content-tree/ContentTree.svelte';

	let { a_ref, clone_urls }: { a_ref: RepoRef; clone_urls: string[] } = $props();
	const fetchReadme = async () => {
		store.readme[a_ref] = readme_defaults;
		let text: string | undefined;
		try {
			let readme_urls = cloneArrayToReadMeUrls(clone_urls);
			// prioritise using github as it doesn't require a proxy
			readme_urls = [
				...readme_urls.filter((url) => url.includes('raw.githubusercontent.com')),
				...readme_urls.filter((url) => !url.includes('raw.githubusercontent.com'))
			];
			for (let i = 0; i < readme_urls.length; i++) {
				try {
					const res = await fetch(
						readme_urls[i]
						// readme_urls[i].includes('raw.githubusercontent.com')
						//   ? readme_urls[i]
						//   : // use proxy as most servers produce a CORS error
						//     `/git_proxy/readme/${encodeURIComponent(readme_urls[i])}`
					);
					if (res.ok) {
						text = await res.text();
						break;
					} else {
						continue;
					}
				} catch {
					continue;
				}
			}
		} catch {
			/* empty */
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
