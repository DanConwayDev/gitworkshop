<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		complete_bg_color_class,
		pc = 0,
		children
	}: {
		complete_bg_color_class: string;
		pc?: number;
		children?: Snippet;
	} = $props();
</script>

<div class="relative w-full overflow-hidden rounded">
	<div
		class="{complete_bg_color_class} absolute top-0 bottom-0 left-0 transition-all duration-300"
		style="width: {Math.min(pc, 100)}%;"
	></div>
	<div class="relative">
		{@render children?.()}
	</div>
</div>
