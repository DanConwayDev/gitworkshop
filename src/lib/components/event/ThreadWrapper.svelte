<script lang="ts">
	import { icons_misc } from '$lib/icons';
	import type { Snippet } from 'svelte';

	let {
		num_replies,
		missing_parent = false,
		hide_by_default = false,
		children
	}: {
		num_replies: number;
		missing_parent?: boolean;
		hide_by_default?: boolean;
		children: Snippet;
	} = $props();
	let show_replies = $state(!hide_by_default);

	const toggle_replies = () => {
		show_replies = !show_replies;
	};
</script>

{#if missing_parent}<div
		class="text-content border-error bg-error text-error-content border-3 border-x text-center text-sm opacity-50"
	>
		missing parent note
	</div>{/if}
<div
	class="border-l pl-1"
	class:border-error={missing_parent}
	class:border-blue-500={!missing_parent}
>
	{#if num_replies > 0}
		{#if show_replies}
			<div class="opacity-60 hover:opacity-90" class:relative={show_replies}>
				<button
					onclick={() => {
						toggle_replies();
					}}
					class="-mt-1 -ml-1 sm:-mt-6 sm:-ml-1"
					class:absolute={show_replies}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="h-7 w-7 flex-none fill-blue-500 pt-1"
						class:fill-error={missing_parent}
						class:fill-error-content={missing_parent}
						class:fill-blue-500={!missing_parent}
					>
						{#each show_replies ? icons_misc.chevron_up : icons_misc.chevron_down as p (p)}
							<path d={p} />
						{/each}
					</svg>
				</button>
			</div>
		{:else}
			<button
				onclick={() => {
					toggle_replies();
				}}
				class="bg-base-300 hover:bg-base-400 w-full cursor-pointer p-3 text-left"
			>
				show {num_replies} hidden replies
			</button>
		{/if}
	{/if}
	<div class:hidden={!show_replies}>
		{@render children?.()}
	</div>
</div>
