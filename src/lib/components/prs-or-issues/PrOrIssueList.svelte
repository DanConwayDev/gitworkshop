<script lang="ts">
	import type { IssueOrPRTableItem, RepoRoute } from '$lib/types';
	import PrOrIssueItem from './PrOrIssueItem.svelte';

	let {
		title = '',
		type,
		table_items = [],
		repo_route = undefined,
		loading = false,
		show_repo = false,
		limit = 0,
		allow_more = true,
		sort_youngest_first = false
	}: {
		title?: string;
		type: 'issue' | 'pr';
		table_items?: IssueOrPRTableItem[];
		repo_route?: RepoRoute;
		loading?: boolean;
		show_repo?: boolean;
		limit?: number;
		allow_more?: boolean;
		sort_youngest_first?: boolean;
	} = $props();
	let current_limit = $state(limit);

	let potentially_sorted_items = $derived(
		sort_youngest_first
			? [...table_items].sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
			: table_items
	);
</script>

<div class="">
	{#if title.length > 0}
		<div class="prose">
			<h4>{title}</h4>
		</div>
	{/if}
	{#if table_items.length == 0 && !loading}
		<p class="prose">None</p>
	{/if}
	<ul class=" divide-y divide-base-400">
		{#each potentially_sorted_items as table_item, index}
			{#if current_limit === 0 || index + 1 <= current_limit}
				<PrOrIssueItem {type} {table_item} {repo_route} {show_repo} />
			{/if}
		{/each}
		{#if loading}
			<PrOrIssueItem {type} />
			{#if table_items.length == 0}
				<PrOrIssueItem {type} />
				<PrOrIssueItem {type} />
			{/if}
		{:else if allow_more && limit !== 0 && table_items.length > current_limit}
			<button
				onclick={() => {
					current_limit = current_limit + 5;
				}}
				class="btn mt-3 p-3 font-normal">more</button
			>
		{/if}
	</ul>
</div>
