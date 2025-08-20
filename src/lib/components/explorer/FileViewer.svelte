<script lang="ts">
	import { stringToMarkDownOnlyDocTree } from '$lib/doc_tree';
	import CodeHighlight from '../CodeHighlight.svelte';
	import ContentTree from '../content-tree/ContentTree.svelte';

	let { path, content }: { path: string; content?: string } = $props();
	let use_markdown = $state(true);
</script>

<div class="border-base-400 my-3 rounded-lg border">
	<div class="border-base-400 bg-base-300 flex border-b">
		<div class="grow px-6 py-3"><h4 class="">{path}</h4></div>
		{#if path.toLowerCase().endsWith('.md')}
			<div class="tabs tabs-box tabs-md">
				<button
					class="tab"
					class:tab-active={!use_markdown}
					onclick={() => {
						use_markdown = false;
					}}><span class="text-xs">Raw</span></button
				>
				<button
					class="tab"
					class:tab-active={use_markdown}
					onclick={() => {
						use_markdown = true;
					}}><span class="text-xs">Markdown</span></button
				>
			</div>
		{/if}
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
	{:else if path.toLowerCase().endsWith('.md') && use_markdown}
		<div class="p-6">
			<article class="">
				<ContentTree node={stringToMarkDownOnlyDocTree(content, true)} />
			</article>
		</div>
	{:else}
		<article class="">
			<CodeHighlight {content} />
		</article>
	{/if}
</div>
