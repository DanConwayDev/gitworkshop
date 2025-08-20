<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
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
</script>

<EventWrapperLite {event} name_first>
	{#if with_permission}updated
	{:else}suggested update to
	{/if} PR branch
</EventWrapperLite>
