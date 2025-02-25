<script lang="ts">
	import type { IssueOrPRTableItem, ThreadTreeNode } from '$lib/types';
	import ComposeReply from '../compose/ComposeReply.svelte';
	import EventCard from './EventCard.svelte';
	import ThreadWrapper from './ThreadWrapper.svelte';

	let {
		tree,
		issue_or_pr_table_item,
		show_compose
	}: {
		tree: ThreadTreeNode;
		issue_or_pr_table_item: IssueOrPRTableItem;
		show_compose: boolean;
	} = $props();
	let just_replied = $state(false);

	const countReplies = (node: ThreadTreeNode): number => {
		return (
			node.child_nodes.length +
			node.child_nodes.reduce((total, child) => total + countReplies(child), 0)
		);
	};
</script>

{#snippet renderThread(node: ThreadTreeNode)}
	<ThreadWrapper num_replies={countReplies(node)}>
		{#each node.child_nodes as childNode}
			<EventCard {issue_or_pr_table_item} event={childNode.event} />
			{@render renderThread(childNode)}
		{/each}
	</ThreadWrapper>
{/snippet}

{#if tree}
	<EventCard {issue_or_pr_table_item} event={tree.event} />
	{@render renderThread(tree)}
	{#if show_compose && !just_replied}
		<ComposeReply
			{issue_or_pr_table_item}
			event={tree.event}
			sentFunction={() => {
				just_replied = true;
				setTimeout(() => {
					just_replied = false;
				}, 2000);
			}}
			autofocus={false}
		/>
	{/if}
{/if}
