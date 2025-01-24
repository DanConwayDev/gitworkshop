<script lang="ts">
	import { type TextNode, type TagMark, type Mark, isTagMark } from 'nostr-editor';
	import ContentTree from './ContentTree.svelte';
	import type { AtLeastOneArray } from '$lib/types';

	let { node }: { node: TextNode & { marks: AtLeastOneArray<TagMark> & Mark[] } } = $props();

	// const tag: TagMark = node.marks.find((m) => isTagMark(m));

	// TODO this could be a link to the issue / pr page filtered by tag
</script>

<u><ContentTree node={{ ...node, marks: node.marks.filter((m) => !isTagMark(m)) }} /> </u>
