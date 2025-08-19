<script lang="ts">
	import type { IssueOrPRTableItem } from '$lib/types';
	import UserHeader from '../user/UserHeader.svelte';
	import StatusSelector from './StatusSelector.svelte';

	let { table_item }: { table_item?: IssueOrPRTableItem } = $props();
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
			<StatusSelector item={table_item} />
		{/if}
	</div>

	<div>
		{#if !table_item}
			<div class="badge skeleton w-20"></div>
			<div class="badge skeleton w-20"></div>
		{:else}
			<h4>Labels</h4>
			{#each table_item.tags as label (label)}
				<div class="badge badge-secondary mr-2">{label}</div>
			{/each}
		{/if}
	</div>
</div>
