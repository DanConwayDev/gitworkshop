<script lang="ts">
	import store from '$lib/store.svelte';
	import { onMount, type Snippet } from 'svelte';
	import { slide } from 'svelte/transition';

	let {
		classes = 'w-[600px]',
		is_open = $bindable(false),
		side = 'right',
		children
	}: { classes?: string; is_open: boolean; side?: 'right' | 'left'; children: Snippet } = $props();
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (is_open && event.key === 'Escape') toggle();
		});
	});
</script>

{#if is_open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="pointer-events-auto fixed inset-0 z-10 h-16" onclick={toggle}></div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="bg-base-200 fixed inset-0 z-10 mt-16 opacity-50" onclick={toggle}></div>

	<div
		class="fixed top-16 {side}-0 z-20 {classes} bg-base-400 overflow-y-auto px-2 drop-shadow-2xl"
		style="height: calc(100vh); max-width: calc(100vw - 40px);"
		transition:slide={{ axis: 'x', duration: 100 }}
	>
		{@render children?.()}
	</div>
{/if}
