<script lang="ts">
	import { stringToDocTree } from '$lib/doc_tree';
	import store from '$lib/store.svelte';
	import CodeHighlight from '../CodeHighlight.svelte';
	import ContentTree from '../content-tree/ContentTree.svelte';

	let { path, content }: { path: string; content?: string } = $props();
</script>

<div class="my-3 rounded-lg border border-base-400">
	<div class="border-b border-base-400 bg-base-300 px-6 py-3">
		<h4 class="">{path}</h4>
	</div>
	{#if !content}
		<div class="p-6">
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="skeleton my-2 h-4"></div>
			<div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
		</div>
	{:else if path.toLowerCase().endsWith('.md')}
		<div class="p-6">
			<article class="">
				<ContentTree node={stringToDocTree(content)} />
			</article>
		</div>
	{:else}
		<article class="">
			<CodeHighlight {content} {path} />
		</article>
	{/if}
</div>
