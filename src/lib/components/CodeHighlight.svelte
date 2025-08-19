<script>
	import { HighlightAuto, LineNumbers } from 'svelte-highlight';
	import github from 'svelte-highlight/styles/github-dark';
	// Props
	let { content, path } = $props();

	// Derive language from file path
	// let language = $derived(getLanguageFromPath(path));
</script>

<svelte:head>
	{@html github}
</svelte:head>

<HighlightAuto code={content} let:highlighted>
	<LineNumbers
		wrapLines
		--border-color="var(--fallback-b3, oklch(var(--b3) / var(--tw-bg-opacity, 1)))0"
		--line-number-color="#8b949e"
		{highlighted}
	/>
</HighlightAuto>

<style>
	:global(.hljs) {
		padding: 1rem;
		margin: 0;
	}
</style>
