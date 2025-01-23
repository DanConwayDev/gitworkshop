<script lang="ts">
	import type { IssueOrPRTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';

	let { type, table_item }: { type: 'pr' | 'issue'; table_item?: IssueOrPRTableItem } = $props();
	let labels = $state([]);
</script>

<div class="max-w-md">
	<div>
		{#if !table_item}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else}
			<h4>Author</h4>
			<UserHeader user={table_item.author} />
		{/if}
	</div>

	<div>
		{#if !table_item}
			<div class="skeleton my-3 h-5 w-20"></div>
			<div class="badge skeleton my-2 block w-60"></div>
			<div class="badge skeleton my-2 block w-40"></div>
		{:else}
			<h4>Status</h4>
			TODO
			<!-- <StatusSelector {type} status={table_item.status} proposal_or_issue_id={table_item.uuid} /> -->
		{/if}
	</div>

	<div>
		{#if !table_item}
			<div class="badge skeleton w-20"></div>
			<div class="badge skeleton w-20"></div>
		{:else}
			<h4>Labels</h4>
			{#each labels as label}
				<div class="badge badge-secondary mr-2">{label}</div>
			{/each}
		{/if}
	</div>
</div>
