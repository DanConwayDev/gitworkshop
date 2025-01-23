<script lang="ts">
	import { getThreadTrees } from '$lib/thread_tree';
	import type { NostrEvent } from 'nostr-tools';
	import ThreadTree from './ThreadTree.svelte';

	let {
		type,
		event,
		replies = [],
		show_compose = true
	}: {
		type: 'issue' | 'pr';
		event: NostrEvent;
		replies: NostrEvent[];
		show_compose: boolean;
	} = $props();

	let thread_trees = $derived(getThreadTrees(type, event, replies));
</script>

{#each thread_trees as tree, i}
	{#if i > 0}
		<div class="divider">new revision</div>
	{/if}
	<ThreadTree {type} {tree} show_compose={show_compose && thread_trees.length - 1 === i} />
{/each}
