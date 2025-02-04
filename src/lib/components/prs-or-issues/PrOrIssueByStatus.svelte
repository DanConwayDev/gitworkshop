<script lang="ts">
	import { statusKindtoText } from '$lib/kinds';
	import { IssueOrPrStatus, type IssueOrPRTableItem, type RepoRoute } from '$lib/types';
	import PrOrIssueList from './PrOrIssueList.svelte';

	let {
		type,
		table_items = [],
		repo_route,
		loading = false
	}: {
		type: 'issue' | 'pr';
		table_items: IssueOrPRTableItem[];
		repo_route: RepoRoute;
		loading?: boolean;
	} = $props();

	let status = $state(IssueOrPrStatus.Applied);

	let filtered_items = $derived(
		table_items.filter((e) => {
			if (status === IssueOrPrStatus.Open)
				return [IssueOrPrStatus.Open, IssueOrPrStatus.Draft].includes(e.status);
			return e.status === status;
		})
	);
</script>

<div class="mt-2 rounded-tr-lg border border-base-400">
	<div class="flex rounded-r-lg bg-slate-900">
		<div class="flex-none">
			<div class="tabs tabs-lifted tabs-xs p-2">
				<button
					role="tab"
					class="tab"
					class:opacity-50={status !== IssueOrPrStatus.Open}
					class:font-bold={status == IssueOrPrStatus.Open}
					onclick={() => {
						status = IssueOrPrStatus.Open;
					}}
				>
					{table_items.filter((t) =>
						[IssueOrPrStatus.Open, IssueOrPrStatus.Draft].includes(t.status)
					).length} Open
				</button>
				<button
					role="tab"
					class="tab"
					class:opacity-50={status !== IssueOrPrStatus.Applied}
					class:font-bold={status == IssueOrPrStatus.Applied}
					onclick={() => {
						status = IssueOrPrStatus.Applied;
					}}
				>
					{table_items.filter((t) => t.status === IssueOrPrStatus.Applied).length} Completed
				</button>

				<button
					role="tab"
					class="tab"
					class:opacity-50={status !== IssueOrPrStatus.Closed}
					class:font-bold={status == IssueOrPrStatus.Closed}
					onclick={() => {
						status = IssueOrPrStatus.Closed;
					}}
				>
					{table_items.filter((t) => t.status === IssueOrPrStatus.Closed).length} Closed
				</button>
			</div>
		</div>
		<div class="flex-auto"></div>
		<div class="flex-none">
			{#if type === 'issue'}
				<a class="btn btn-success btn-sm h-full text-base-400" href={`${repo_route.s}/issues/new`}>
					create issue
				</a>
			{/if}
		</div>
	</div>
	{#if !loading && filtered_items.length === 0}
		<div class="py-10 text-center lowercase">
			can't find any {statusKindtoText(status, 'issue')} issues
		</div>
	{:else}
		<PrOrIssueList {type} table_items={filtered_items} {repo_route} {loading} />
	{/if}
</div>
