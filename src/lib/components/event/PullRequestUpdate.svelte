<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { getTagValue } from '$lib/utils';
	import { icons_misc } from '$lib/icons';
	let {
		event,
		issue_or_pr_table_item
	}: { event: NostrEvent; issue_or_pr_table_item?: IssueOrPRTableItem } = $props();

	let item_maintainers_query = $derived(
		liveQueryState(async () => {
			let a_refs = issue_or_pr_table_item?.repos ?? [];
			let items = await db.repos.bulkGet(a_refs);
			let maintainers: PubKeyString[] = [];
			items.forEach((item) => item?.maintainers?.forEach((m) => maintainers.push(m)));
			return [issue_or_pr_table_item?.author, ...maintainers];
		})
	);
	let item_maintainers = $derived(
		item_maintainers_query.current ?? [issue_or_pr_table_item?.author]
	);
	let with_permission = $derived(item_maintainers.includes(event.pubkey));

	let commit_id = $derived(getTagValue(event.tags, 'c') || '[commit_id unknown]');
	let commit_id_shorthand = $derived(commit_id.substring(0, 8) || '[commit_id unknown]');
</script>

<EventWrapperLite {event} name_first>
	<span class="text-sm">
		{#if with_permission}updated
		{:else}suggested update to
		{/if} PR branch
	</span>
	<span class="badge badge-secondary badge-sm mx-1">{commit_id_shorthand}</span>
	<button
		class="btn btn-ghost btn-xs"
		onclick={() => {
			navigator.clipboard.writeText(commit_id);
		}}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="fill-base-content ml-1 inline h-4 w-4 flex-none opacity-50 group-hover:opacity-100"
		>
			{#each icons_misc.copy as d (d)}
				<path {d} />
			{/each}
		</svg>
	</button>
</EventWrapperLite>
