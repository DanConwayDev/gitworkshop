<script lang="ts">
	import type { CommitInfo } from '$lib/types/git-manager';
	import { pr_icon_path } from './icons';

	let { infos }: { infos: CommitInfo[] } = $props();
</script>

{#snippet showInfoLine(info: CommitInfo)}
	<div class="bg-base-200 m-1 my-2 flex items-center gap-2 rounded p-2">
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

		<div class="badge badge-sm shrink-0">
			{info.oid.substring(0, 8)}
		</div>
	</div>
{/snippet}

<div class="">
	{#each infos as info (info.oid)}
		{@render showInfoLine(info)}
	{/each}
</div>
