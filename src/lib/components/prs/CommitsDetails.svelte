<script lang="ts">
	import type { CommitInfo } from '$lib/types/git-manager';
	import { onMount } from 'svelte';
	import CommitDetails from './CommitDetails.svelte';
	import { getGitLog } from '$lib/git-utils';
	import { pr_icon_path } from './icons';
	import FromNow from '../FromNow.svelte';
	import AlertWarning from '../AlertWarning.svelte';
	import GitFetchingStatus from '../GitFetchingStatus.svelte';
	import store from '$lib/store.svelte';
	import { slide } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		infos,
		loading,
		clone_urls,
		sub_filter = [],
		grouped_by_date = false,
		lite_view = false
	}: {
		infos: CommitInfo[] | undefined;
		loading: boolean;
		clone_urls: string[];
		sub_filter?: string[];
		grouped_by_date?: boolean;
		lite_view?: boolean;
	} = $props();

	let git_status = $derived(getGitLog(store.git_log, sub_filter));

	let expanded = new SvelteSet<string>();
	let user_interacted = $state(false);
	function toggleExpanded(oid: string) {
		user_interacted = true;
		if (expanded.has(oid)) expanded.delete(oid);
		else expanded.add(oid);
	}

	$effect(() => {
		if (lite_view && infos && infos.length > 0 && !user_interacted) {
			expanded.add(infos[0].oid);
		}
	});

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
</script>

{#snippet showItem(info: CommitInfo)}
	{#if lite_view}
		<button
			class="border-base-400 bg-base-100 hover:bg-base-200 flex w-full cursor-pointer items-start gap-3 border-x px-3 py-3 text-left sm:flex-row sm:items-center sm:gap-4"
			onclick={() => toggleExpanded(info.oid)}
			aria-expanded={expanded.has(info.oid)}
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

			<!-- right: id + time + chevron -->
			<div class="ml-auto flex shrink-0 items-center gap-3">
				<div class="flex flex-col items-end text-right">
					<div class="badge badge-sm">{info.oid.substring(0, 8)}</div>
					<div class="text-base-content/60 mt-1 text-xs">
						<FromNow unix_seconds={info.committer.timestamp} />
					</div>
				</div>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					class="text-base-content/40 h-4 w-4 flex-none transition-transform"
					class:rotate-180={expanded.has(info.oid)}
				>
					<path
						fill="currentColor"
						d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
					/>
				</svg>
			</div>
		</button>
		{#if expanded.has(info.oid)}
			<div transition:slide={{ duration: 150 }}>
				<CommitDetails {info} />
			</div>
		{/if}
	{:else}
		<CommitDetails {info} />
	{/if}
{/snippet}

<div class="">
	{#if git_status && git_status.level === 'warning'}
		<div class="mb-4">
			<AlertWarning mt={4}>
				<div>{git_status.msg}</div>
			</AlertWarning>
		</div>
	{/if}
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
	{:else}
		<div class="relative mb-4">
			<GitFetchingStatus
				loading={loading || !waited}
				{waited}
				git_log={store.git_log}
				{sub_filter}
				{clone_urls}
				commits_or_diffs={infos}
				errorMessage="Error: cannot find commits"
				use_progress_wrapper={true}
			/>
		</div>
	{/if}
</div>
