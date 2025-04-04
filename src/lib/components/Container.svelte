<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		no_wrap = false,
		no_wrap_on_md = false
	}: { children: Snippet; no_wrap?: boolean; no_wrap_on_md?: boolean } = $props();
</script>

<div class="mx-auto lg:container">
	{#if no_wrap}
		{@render children?.()}
	{:else if no_wrap_on_md}
		<div class="md:px-3">
			{@render children?.()}
		</div>
	{:else}
		<div class="px-3">
			{@render children?.()}
		</div>
	{/if}
</div>
