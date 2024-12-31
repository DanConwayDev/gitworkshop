<script lang="ts">
	import { icons_misc } from './icons';

	export let label: string = '';
	export let content: string = '';
	export let border_color = 'primary';
	export let no_border = false;
	export let icon: undefined | string[] = undefined;
	export let truncate: undefined | [number, number] = undefined;
	const truncatedContent = () => {
		if (truncate && content.length > truncate[0] + truncate[1] + 3) {
			return `${content.substring(0, truncate[0])}...${content.substring(content.length - 1 - truncate[1])}`;
		}
		return content;
	};
	let copied = false;
</script>

<!-- eslint-disable-next-line svelte/valid-compile -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
	class="group cursor-pointer"
	class:mt-3={!no_border}
	on:click={async () => {
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch {
			/* empty */
		}
	}}
>
	{#if label.length > 0}
		{label}
		{#if copied}<span class="text-sm text-success opacity-50"> (copied to clipboard)</span>{/if}
	{/if}
	<div
		class="items flex w-full items-center rounded-lg border border-{border_color} opacity-50"
		class:mt-1={no_border && label.length === 0}
		class:border={!no_border}
		class:p-3={!no_border}
		class:text-success={copied}
	>
		{#if icon}<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="mr-1 mt-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
				class:fill-success={copied}
			>
				{#each icon as d}
					<path {d} />
				{/each}
			</svg>{/if}
		<div class="truncate text-sm" class:flex-auto={!no_border} class:flex-none={no_border}>
			{truncatedContent()}
		</div>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50 group-hover:opacity-100"
			class:opacity-100={copied}
			class:fill-success={copied}
		>
			{#each icons_misc.copy as d}
				<path {d} />
			{/each}
		</svg>
	</div>
</div>
