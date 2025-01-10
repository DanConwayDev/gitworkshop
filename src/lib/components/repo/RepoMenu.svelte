<script lang="ts">
	import { issue_icon_path } from '$lib/components/issues/icons';
	import { proposal_icon_path as pr_icon_path } from '$lib/components/prs/icons';
	import { network_status } from '$lib/internal_states.svelte';
	import { recentlyCompletedCheck } from '$lib/type-helpers/general';
	import { IssueOrPrStatus, type RepoTableItem } from '$lib/types';
	import type { RepoPage } from '$lib/types/ui';

	let { repo, selected_tab = 'about' }: { repo?: RepoTableItem; selected_tab: RepoPage } = $props();
	let recently_completed_check = $derived(
		network_status.offline || (repo ? recentlyCompletedCheck(repo) : false)
	);
	let readme_available = false;
	let repo_link = '/naddr';
	let open_prs_count = $derived(
		repo && repo.PRs
			? repo.PRs[IssueOrPrStatus.Open].length + repo.PRs[IssueOrPrStatus.Draft].length
			: 0
	);
	let open_issues_count = $derived(
		repo && repo.PRs
			? repo.PRs[IssueOrPrStatus.Open].length + repo.PRs[IssueOrPrStatus.Draft].length
			: 0
	);
</script>

<div class="flex border-b border-base-400">
	<div role="tablist" class="tabs tabs-bordered flex-none">
		{#if repo}
			{#if readme_available}
				<a href={`${repo_link}`} class="tab" class:tab-active={selected_tab === 'about'}> About </a>
			{/if}
			<a
				href={`${repo_link}/proposals`}
				class="tab"
				class:tab-active={selected_tab === 'proposals'}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
				>
					<path d={pr_icon_path.open_pull} />
				</svg>
				Proposals
				{#if !recently_completed_check}
					<span class="loading loading-spinner loading-xs ml-2 text-neutral"></span>
				{:else if open_prs_count > 0}
					<span class="badge badge-neutral badge-sm ml-2">
						{open_prs_count}
					</span>
				{/if}
			</a>
			<a href={`${repo_link}/issues`} class="tab" class:tab-active={selected_tab === 'issues'}>
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
				{#if !recently_completed_check}
					<span class="loading loading-spinner loading-xs ml-2 text-neutral"></span>
				{:else if open_issues_count > 0}
					<span class="badge badge-neutral badge-sm ml-2">
						{open_issues_count}
					</span>
				{/if}
			</a>
		{/if}
	</div>
	<div class="flex-grow"></div>
</div>
