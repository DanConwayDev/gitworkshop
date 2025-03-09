<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		repo_header_on_page = false
	}: { children: Snippet; repo_header_on_page?: boolean } = $props();

	// appears in the centre of the screen adapting for hardcoded Navbar and Footer heights
	// negative margin 24 matches the margin of the footer
	let height = repo_header_on_page ? 'calc(100vh - 130px - 80px)' : 'calc(100vh - 130px)';
</script>

<div
	class="center-of-gw-screen -mb-24 flex h-screen items-center justify-center"
	style="height: {height}"
>
	{@render children?.()}
</div>

<style>
	.center-of-gw-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}
</style>
