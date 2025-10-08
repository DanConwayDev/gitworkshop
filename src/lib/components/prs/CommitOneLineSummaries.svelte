<script lang="ts">
	import type { CommitInfo } from '$lib/types/git-manager';
	import { pr_icon_path } from './icons';

	let { infos, loading }: { infos: CommitInfo[] | undefined; loading: boolean } = $props();
</script>

{#snippet showInfoLine(info: CommitInfo)}
	<div class="bg-base-200 my-2 flex items-center gap-2 rounded p-2">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="text-base-content h-4 w-4 flex-none"
		>
			<title>Commit</title>
			<path fill="currentColor" d={pr_icon_path.commit} />
		</svg>

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<div class="flex-grow truncate font-mono text-sm font-medium">{info.message}</div>
				{#if info.author.name}
					<div class="text-base-content/50 shrink-0 text-xs">{info.author.name}</div>
				{/if}
			</div>
		</div>

		<div class="commit-id text-base-content/40 ml-2 flex-shrink-0 text-xs">
			{info.oid.substring(0, 8)}
		</div>
	</div>
{/snippet}

<div class="">
	{#if infos && infos.length > 0}
		{#each infos as info (info.oid)}
			{@render showInfoLine(info)}
		{/each}
	{:else if loading}
		<div class="bg-base-200 skeleton my-2 h-7 rounded p-2"></div>
		<div class="bg-base-200 skeleton my-2 h-7 rounded p-2"></div>
	{:else}
		<div
			class="bg-base-200/70 text-base-content/65 my-2 flex items-center gap-3 rounded-lg p-3 text-sm"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="h-4 w-4 flex-none"
				aria-hidden="true"
			>
				<path
					fill="currentColor"
					d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.93 4.412-1 4a.5.5 0 0 0 .98.196l1-4a.5.5 0 1 0-.98-.196zM8 11a.75.75 0 1 0 0-1.5A.75.75 0 0 0 8 11z"
				/>
			</svg>

			<div class="min-w-0 flex-1">
				<div class="text-base-content/75 truncate font-medium">Couldn’t load commits</div>
				<div class="text-base-content/50 text-xs">Check your connection or try again later</div>
			</div>
		</div>
	{/if}
</div>
