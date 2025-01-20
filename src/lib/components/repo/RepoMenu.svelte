<script lang="ts">
	import { issue_icon_path } from '$lib/components/issues/icons';
	import { pr_icon_path as pr_icon_path } from '$lib/components/prs/icons';
	import { icons_misc } from '$lib/icons';
	import { network_status } from '$lib/internal_states.svelte';
	import { IssueOrPrStatus, type RepoRoute, type RepoTableItem } from '$lib/types';
	import type { RepoPage, WithLoading } from '$lib/types/ui';

	let {
		repo,
		repo_route,
		selected_tab = 'about'
	}: {
		repo?: RepoTableItem & WithLoading;
		repo_route: RepoRoute;
		selected_tab: RepoPage;
	} = $props();

	let loading = $derived(network_status.offline || !repo || repo.loading);

	let readme_available = false;
	let open_prs_count = $derived(
		repo && repo.PRs
			? repo.PRs[IssueOrPrStatus.Open].length + repo.PRs[IssueOrPrStatus.Draft].length
			: 0
	);
	let open_issues_count = $derived(
		repo && repo.issues
			? repo.issues[IssueOrPrStatus.Open].length + repo.issues[IssueOrPrStatus.Draft].length
			: 0
	);
</script>

<div class="flex border-b border-base-400">
	<div role="tablist" class="tabs tabs-bordered flex-none">
		{#if readme_available}
			<a href={`$/${repo_route.s}`} class="tab" class:tab-active={selected_tab === 'about'}>
				About
			</a>
		{/if}
		<a href={`/${repo_route.s}/prs`} class="tab" class:tab-active={selected_tab === 'proposals'}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
			>
				<path d={pr_icon_path.open_pull} />
			</svg>
			Proposals
			{#if open_prs_count > 0}
				<span class="badge badge-neutral badge-sm ml-2">
					{open_prs_count}
				</span>
			{/if}
			{#if loading}
				<span class="loading loading-spinner loading-xs ml-2 text-neutral"></span>
			{/if}
		</a>
		<a href={`/${repo_route.s}/issues`} class="tab" class:tab-active={selected_tab === 'issues'}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
			>
				{#each issue_icon_path.open as p}
					<path d={p} />
				{/each}
			</svg>
			Issues
			{#if open_issues_count > 0}
				<span class="badge badge-neutral badge-sm ml-2">
					{open_issues_count}
				</span>
			{/if}
			{#if loading}
				<span class="loading loading-spinner loading-xs ml-2 text-neutral"></span>
			{/if}
		</a>
		<a href={`/${repo_route.s}/actions`} class="tab" class:tab-active={selected_tab === 'actions'}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
			>
				{#each icons_misc.actions as p}
					<path d={p} />
				{/each}
			</svg>
			Actions (experimental)
		</a>
	</div>
	<div class="flex-grow"></div>
</div>
