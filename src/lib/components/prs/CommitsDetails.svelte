<script lang="ts">
	import type { CommitInfo, GitServerStatus } from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import CommitDetails from './CommitDetails.svelte';
	import type { SvelteMap } from 'svelte/reactivity';
	import GitServerStateIndicator from '../GitServerStateIndicator.svelte';
	import { gitProgressesToPc, gitProgressToPc, serverStatustoMsg } from '$lib/git-utils';
	import BackgroundProgressWrapper from '../BackgroundProgressWrapper.svelte';
	import { pr_icon_path } from './icons';
	import FromNow from '../FromNow.svelte';

	let {
		infos,
		loading,
		server_status,
		grouped_by_date = false,
		lite_view = false
	}: {
		infos: CommitInfo[] | undefined;
		loading: boolean;
		server_status: SvelteMap<string, GitServerStatus>;
		grouped_by_date?: boolean;
		lite_view?: boolean;
	} = $props();
	let waited = $state(false);
	onMount(() => {
		setTimeout(() => {
			waited = true;
		}, 3000);
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
	let pcLoaded = $derived.by(() => {
		return gitProgressesToPc(
			Array.from(server_status.values()).flatMap((s) => (s.progress ? [s.progress] : []))
		);
		// for (const entry of server_status.values()) {
		// 	if (entry && entry.progress) {
		// 		console.log('bla');
		// 		console.log(entry.progress);
		// 		console.log(gitProgressToPc(entry.progress));
		// 		return gitProgressToPc(entry.progress);
		// 	}
		// }
		// return 0;
	});
	// value={status.progress ? gitProgressToPc(status.progress) : 10}
</script>

{#snippet showServerStatus()}
	{#if server_status}
		<div class="mx-5 my-5">
			{#each server_status.entries() as [remote, status] (remote)}
				<BackgroundProgressWrapper
					complete_bg_color_class="bg-base-400"
					pc={status.progress ? gitProgressToPc(status.progress) : 0}
				>
					<GitServerStateIndicator state={status.state} />
					{status.short_name}
					{#if status.with_proxy}
						<span class="text-base-content/50 text-xs">(via proxy)</span>
					{/if}
					<span class="text-base-content/50 text-xs">{status.state}</span>
					<span class="text-base-content/50 text-xs">{serverStatustoMsg(status)}</span>
				</BackgroundProgressWrapper>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet showItem(info: CommitInfo)}
	{#if !lite_view}
		<div
			class="border-base-400 bg-base-200 bg-base-100 flex items-start gap-3 border-x px-3 py-3 sm:flex-row sm:items-center sm:gap-4"
			class:border-t={false}
			class:rounded-lg={false}
			role="group"
			aria-label="Commit summary"
			title={info.message}
		>
			<!-- left: icon + author -->
			<div class="flex min-w-0 items-center gap-1 sm:gap-3">
				<div
					class="sm:bg-base-300 -ml-1 flex shrink-0 items-center justify-center rounded-full sm:ml-0 sm:h-10 sm:w-10"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="text-base-content h-5 w-5 rotate-90"
						aria-hidden="true"
					>
						<title>Commit</title>
						<path fill="currentColor" d={pr_icon_path.commit} />
					</svg>
				</div>

				<div class="min-w-0">
					<div class="text-base-content truncate text-sm font-medium">
						{info.message.split('\n')[0]}
					</div>
					<div class="text-base-content/60 truncate text-xs">
						{info.author.name}
					</div>
				</div>
			</div>

			<!-- right: id + time -->
			<div class="ml-auto flex shrink-0 items-center gap-3">
				<div class="flex flex-col items-end text-right">
					<div class="badge badge-sm">{info.oid.substring(0, 8)}</div>
					<div class="text-base-content/60 mt-1 text-xs">
						<FromNow unix_seconds={info.committer.timestamp} />
					</div>
				</div>
			</div>
		</div>
	{:else if true}
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
	{:else}
		<CommitDetails {info} />
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
						{@render showItem(info)}
					{/each}
				</div>
			{/each}
		{:else}
			{#each infos as info (info.oid)}
				{@render showItem(info)}
			{/each}
		{/if}
	{:else if loading || !waited}
		<div class="relative mb-4">
			<div class="skeleton border-base-400 my-2 rounded border border-2 opacity-70">
				<BackgroundProgressWrapper complete_bg_color_class="bg-base-400" pc={pcLoaded}>
					<div class="p-2">
						<div
							class="text-center transition-opacity duration-2000"
							class:opacity-0={!waited && loading}
						>
							<span class="loading loading-spinner loading-sm opacity-60"></span>
							<span class=" text-muted ml-2 text-[0.85rem] font-medium">fetching commits</span>
						</div>
					</div>
				</BackgroundProgressWrapper>
				<div class="">
					<div
						class="min-h-16 transition-opacity duration-2000"
						class:opacity-0={!waited && loading}
					>
						{@render showServerStatus()}
					</div>
				</div>
			</div>
		</div>
	{:else}
		<div class="relative mb-4">
			<div class="bg-base-200 border-error/90 my-2 rounded border border-2">
				<div class="bg-error text-error-content p-2 text-center">Error: cannot find commits</div>
				<div class="">
					<div
						class="min-h-16 transition-opacity duration-1500"
						class:opacity-0={!waited && loading}
					>
						{@render showServerStatus()}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
