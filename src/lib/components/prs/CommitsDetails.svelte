<script lang="ts">
	import type { CommitInfo, GitServerStatus } from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import CommitDetails from './CommitDetails.svelte';
	import type { SvelteMap } from 'svelte/reactivity';
	import GitServerStateIndicator from '../GitServerStateIndicator.svelte';

	let {
		infos,
		loading,
		server_status,
		grouped_by_date = false
	}: {
		infos: CommitInfo[] | undefined;
		loading: boolean;
		server_status: SvelteMap<string, GitServerStatus>;
		grouped_by_date?: boolean;
	} = $props();
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

{#snippet showServerStatus()}
	{#if server_status}
		<div class="mx-5 my-5">
			{#each server_status.entries() as [remote, status] (remote)}
				<div>
					<GitServerStateIndicator state={status.state} />
					{status.short_name}
					{#if status.with_proxy}
						<span class="text-base-content/50 text-xs">(via proxy)</span>
					{/if}
					<span class="text-base-content/50 text-xs">{status.state}</span>
					<span class="text-base-content/50 text-xs">{status.msg}</span>
				</div>
			{/each}
		</div>
	{/if}
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
						<CommitDetails {info} />
					{/each}
				</div>
			{/each}
		{:else}
			{#each infos as info (info.oid)}
				<CommitDetails {info} />
			{/each}
		{/if}
	{:else if loading || !waited}
		<div class="relative py-2">
			<div class="bg-base-300 skeleton border-base-400 my-2 rounded border border-2 opacity-70">
				<div class="bg-base-400 p-2">
					<div
						class="text-center transition-opacity duration-3000"
						class:opacity-0={!waited && loading}
					>
						<span class="loading loading-spinner loading-sm opacity-60"></span>
						<span class=" text-muted ml-2 text-[0.85rem] font-medium">fetching commits</span>
					</div>
				</div>
				<div class="">
					<div
						class="min-h-16transition-opacity duration-3000"
						class:opacity-0={!waited && loading}
					>
						{@render showServerStatus()}
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="relative py-2">
			<div class="bg-base-200 border-error/90 my-2 rounded border border-2">
				<div class="bg-error text-error-content p-2 text-center">Error: cannot find commits</div>
				<div class="">
					<div
						class="min-h-16transition-opacity duration-1500"
						class:opacity-0={!waited && loading}
					>
						{@render showServerStatus()}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
