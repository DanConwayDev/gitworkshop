<script lang="ts">
	import type { RepoTableItem } from '$lib/types';
	import { onMount } from 'svelte';
	import RepoSummaryCard from './RepoSummaryCard.svelte';

	let {
		title = undefined,
		repos = [],
		loading = false,
		group_by = undefined
	}: {
		title?: string | undefined;
		repos?: RepoTableItem[];
		loading?: boolean;
		group_by?: 'name' | 'identifier' | undefined;
	} = $props();

	let grouped_repos: RepoTableItem[][] = $derived.by(() => {
		const grouped_repos: RepoTableItem[][] = [];
		repos.forEach((ann) => {
			if (!group_by) {
				grouped_repos.push([ann]);
				return;
			}
			const added_to_group = grouped_repos.some((group, i) => {
				if (group.some((c) => c[group_by] === ann[group_by])) {
					grouped_repos[i].push(ann);
					return true;
				}
				return false;
			});
			if (!added_to_group) grouped_repos.push([ann]);
		});
		return grouped_repos;
	});
	let selected_group: string | undefined = $state(undefined);

	let modalDone = () => {
		selected_group = undefined;
	};

	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') modalDone();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('modal-open') && !target.classList.contains('modal-box'))
				modalDone();
		});
	});
</script>

<div class="min-width @container">
	{#if title && title.length > 0}
		<div class="prose mb-3">
			<h3>{title}</h3>
		</div>
	{/if}
	{#if repos.length == 0 && !loading}
		<p class="prose">None</p>
	{:else}
		<div class="@xlg:grid-cols-4 grid gap-4 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4">
			{#each grouped_repos as group}
				{#if group.length === 0}
					<RepoSummaryCard repo_item={undefined} />
				{:else if group.length === 1}
					{#each group as repo_item}
						<RepoSummaryCard {repo_item} />
					{/each}
				{:else if group_by}
					<div class="stack">
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="border-base-400 bg-base-200 hover:bg-base-300 flex min-h-28 cursor-pointer items-center rounded-lg border p-4"
							onclick={() => {
								selected_group = group[0][group_by];
							}}
						>
							<div class="m-auto text-center">
								<div class="">{group[0][group_by]}</div>
								<div class=" text-sm opacity-50">{group.length} Items</div>
							</div>
						</div>
						{#each group as repo_item}
							<div class="border-base-400 rounded-lg border">
								<RepoSummaryCard {repo_item} />
							</div>
						{/each}
					</div>
				{/if}
			{/each}
			{#if loading}
				<RepoSummaryCard repo_item={undefined} />
				{#if repos.length == 0}
					<RepoSummaryCard repo_item={undefined} />
					<RepoSummaryCard repo_item={undefined} />
				{/if}
			{/if}
		</div>
	{/if}
</div>
{#if selected_group}
	<dialog class="modal modal-open">
		<div class="modal-box max-w-full text-xs text-wrap">
			<div class="prose max-w-full">
				<h3 class="mb-3 max-w-full text-center">
					{group_by}: "{selected_group}"
				</h3>
			</div>
			<div class="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
				{#each repos.filter((summary) => group_by && summary[group_by] === selected_group) as repo_item}
					<RepoSummaryCard {repo_item} />
				{/each}
			</div>
			<div class="modal-action">
				<button class="btn btn-sm" onclick={modalDone}>Close</button>
			</div>
		</div>
	</dialog>
{/if}
