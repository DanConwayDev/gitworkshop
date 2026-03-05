<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import type { IssueOrPRTableItem, PubKeyString } from '$lib/types';
	import EventWrapperLite from './EventWrapperLite.svelte';
	import { liveQueryState } from '$lib/helpers.svelte';
	import db from '$lib/dbs/LocalDb';
	import { eventToLabelHistoryItem, eventToSubjectHistoryItem } from '$lib/git-utils';

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

	let label_item = $derived(eventToLabelHistoryItem(event));
	let subject_item = $derived(eventToSubjectHistoryItem(event));

	/** The previous subject before this change, derived from the item's subject_history */
	let previous_subject = $derived.by(() => {
		if (!subject_item || !issue_or_pr_table_item) return undefined;
		const history = issue_or_pr_table_item.subject_history ?? [];
		// find the most recent subject change before this event
		const earlier = history
			.filter((h) => h.created_at < subject_item!.created_at && h.uuid !== subject_item!.uuid)
			.sort((a, b) => b.created_at - a.created_at);
		if (earlier.length > 0) return earlier[0].subject;
		// fall back to the original title from the root event
		return issue_or_pr_table_item.event
			? (issue_or_pr_table_item.event.tags.find((t) => t[0] === 'subject')?.[1] ??
					issue_or_pr_table_item.event.content.split('\n')[0] ??
					'')
			: '';
	});
</script>

{#if subject_item}
	<EventWrapperLite {event} name_first>
		{#if with_permission}
			changed subject
		{:else}
			suggested subject change
		{/if}
		{#snippet children_below()}
			<div class="bg-base-200 mt-2 flex items-baseline gap-2 rounded-lg px-3 py-2 text-sm">
				{#if previous_subject}
					<span class="text-base-content/50 line-through">{previous_subject}</span>
					<span class="text-base-content/30">→</span>
				{/if}
				<span class="font-medium {with_permission ? 'text-base-content' : 'text-base-content/60'}">
					{subject_item.subject}
				</span>
			</div>
		{/snippet}
	</EventWrapperLite>
{:else if label_item}
	<EventWrapperLite {event} name_first>
		{#if with_permission}
			added {label_item.labels.length === 1 ? 'label' : 'labels'}
		{:else}
			suggested {label_item.labels.length === 1 ? 'label' : 'labels'}
		{/if}
		{#snippet children_below()}
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each label_item.labels as label (label)}
					<span
						class="badge badge-sm"
						class:badge-secondary={with_permission}
						class:badge-outline={!with_permission}
					>
						{label}
					</span>
				{/each}
			</div>
		{/snippet}
	</EventWrapperLite>
{/if}
