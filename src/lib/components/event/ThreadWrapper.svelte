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
		class="border-3 text-content border-x border-error bg-error text-center text-sm text-error-content opacity-50"
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
					class="-ml-1 -mt-1 sm:-ml-1 sm:-mt-6"
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
						{#each show_replies ? icons_misc.chevron_up : icons_misc.chevron_down as p}
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
				class="w-full cursor-pointer bg-base-300 p-3 text-left hover:bg-base-400"
			>
				show {num_replies} hidden replies
			</button>
		{/if}
	{/if}
	<div class:hidden={!show_replies}>
		{@render children?.()}
	</div>
</div>
