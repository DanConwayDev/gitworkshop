<script lang="ts">
	import { resolve } from '$app/paths';
	import { issue_icon_path } from '$lib/components/issues/icons';
	import { pr_icon_path as pr_icon_path } from '$lib/components/prs/icons';
	import { icons_misc } from '$lib/icons';
	import store, { network_status } from '$lib/store.svelte';
	import { IssueOrPrStatus, type RepoRoute, type RepoTableItem } from '$lib/types';
	import type { WithLoading } from '$lib/types/ui';

	let {
		repo,
		url
	}: {
		repo?: RepoTableItem & WithLoading;
		url: string;
	} = $props();

	let loading = $derived(network_status.offline || !repo || repo.loading);

	let repo_route = $derived(store.route as RepoRoute);
	let readme_available = $derived(
		!('a_ref' in repo_route) ||
			!store.readme[repo_route.a_ref] ||
			!store.readme[repo_route.a_ref]?.failed
	);
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
	let enable_actions = $derived(store.experimental);
</script>

<div class="scrollbar-hide border-base-400 flex overflow-x-auto border-b">
	<div role="tablist" class="tabs tabs-border min-w-max flex-nowrap">
		{#if readme_available}
			<a
				href={resolve(`/${repo_route.s}`)}
				class="tab"
				class:tab-active={url.includes(`${repo_route.s}/about`) || url.endsWith(repo_route.s)}
			>
				About
			</a>
		{/if}
		<a
			href={resolve(`/${repo_route.s}/prs`)}
			class="tab"
			class:tab-active={url.includes(`${repo_route.s}/prs`)}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="fill-base-content mr-1 mb-1 h-4 w-4 flex-none pt-1 opacity-50"
			>
				<path d={pr_icon_path.open_pull} />
			</svg>
			PRs
			{#if open_prs_count > 0}
				<span class="badge badge-neutral badge-sm ml-2">
					{open_prs_count}
				</span>
			{/if}
			{#if loading}
				<span class="loading loading-spinner loading-xs text-neutral ml-2"></span>
			{/if}
		</a>
		<a
			href={resolve(`/${repo_route.s}/issues`)}
			class="tab"
			class:tab-active={url.includes(`${repo_route.s}/issues`)}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				class="fill-base-content mr-1 mb-1 h-4 w-4 flex-none pt-1 opacity-50"
			>
				{#each issue_icon_path.open as p (p)}
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
				<span class="loading loading-spinner loading-xs text-neutral ml-2"></span>
			{/if}
		</a>
		{#if enable_actions}
			<a
				href={resolve(`/${repo_route.s}/actions`)}
				class="tab"
				class:tab-active={url.includes(`${repo_route.s}/actions`)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					class="fill-base-content mr-1 mb-1 h-4 w-4 flex-none pt-1 opacity-50"
				>
					{#each icons_misc.actions as p (p)}
						<path d={p} />
					{/each}
				</svg>
				Actions
			</a>
		{/if}
	</div>
	<div class="grow"></div>
</div>
