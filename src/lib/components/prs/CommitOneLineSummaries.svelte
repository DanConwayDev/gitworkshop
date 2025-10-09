<script lang="ts">
	import type { CommitInfo } from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import { pr_icon_path } from './icons';
	import { fade } from 'svelte/transition';

	let {
		infos,
		loading,
		grouped_by_date = false
	}: { infos: CommitInfo[] | undefined; loading: boolean; grouped_by_date?: boolean } = $props();
	let waited = $state(false);
	onMount(() => {
		setTimeout(() => {
			waited = true;
		}, 2000);
	});

	// Group commits by date when grouped_by_date is true
	let groupedCommits: { date: string; commits: CommitInfo[] }[] = $derived.by(() => {
		if (!infos || !grouped_by_date) {
			return [];
		}

		const groups: Record<string, CommitInfo[]> = {};

		for (const info of infos) {
			const date = new Date(info.author.timestamp * 1000);
			const dateKey = date.toDateString().replace(/^[A-Za-z]+,\s*/, '');

			if (!groups[dateKey]) {
				groups[dateKey] = [];
			}
			groups[dateKey].push(info);
		}

		// Convert to array and sort by date (newest first)
		return Object.entries(groups)
			.sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
			.map(([date, commits]) => ({ date, commits }));
	});
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
				<div class="flex-grow truncate font-mono text-sm font-medium">
					{info.message.split(/[\r\n]/)[0]}
				</div>
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
		{#if grouped_by_date && groupedCommits.length > 0}
			{#each groupedCommits as { date, commits } (date)}
				<div class="mb-4">
					<div class="text-base-content/70 border-base-300 mb-2 border-b pb-1 text-sm font-medium">
						{date}
					</div>
					{#each commits as info (info.oid)}
						{@render showInfoLine(info)}
					{/each}
				</div>
			{/each}
		{:else}
			{#each infos as info (info.oid)}
				{@render showInfoLine(info)}
			{/each}
		{/if}
	{:else if loading}
		<div class="relative py-2">
			<div class="bg-base-200 skeleton my-2 h-7 rounded p-2"></div>
			<div class="bg-base-200 skeleton my-2 h-7 rounded p-2"></div>
			{#if waited}
				<div
					class="pointer-events-none absolute inset-0 flex items-center justify-center"
					in:fade={{ duration: 500 }}
				>
					<div
						class="bg-base-200 text-muted flex items-center gap-3 rounded-lg px-3 py-2 text-xs opacity-80 shadow-none"
					>
						<span class="loading loading-spinner loading-sm opacity-60"></span>
						<div class="min-w-0">
							<div class="text-muted text-[0.85rem] font-medium">fetching commits</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
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
