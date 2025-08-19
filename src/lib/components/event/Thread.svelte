<script lang="ts">
	import { getThreadTrees } from '$lib/thread_tree';
	import type { NostrEvent } from 'nostr-tools';
	import ThreadTree from './ThreadTree.svelte';
	import type { IssueOrPRTableItem } from '$lib/types';

	let {
		type,
		event,
		issue_or_pr_table_item,
		replies = [],
		show_compose = true
	}: {
		type: 'issue' | 'pr';
		event: NostrEvent;
		issue_or_pr_table_item: IssueOrPRTableItem;
		replies: NostrEvent[];
		show_compose: boolean;
	} = $props();

	let thread_trees = $derived(getThreadTrees(type, event, replies));
</script>

{#each thread_trees as tree, i (tree.event.id)}
	{#if i > 0}
		<div class="divider">new revision</div>
	{/if}
	<ThreadTree
		{issue_or_pr_table_item}
		{tree}
		show_compose={show_compose && thread_trees.length - 1 === i}
	/>
{/each}
