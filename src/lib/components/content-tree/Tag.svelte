<script lang="ts">
	import { type TextNode, type TagMark, type Mark } from 'nostr-editor';
	import type { AtLeastOneArray } from '$lib/types';

	let { node }: { node: TextNode & { marks: AtLeastOneArray<TagMark> & Mark[] } } = $props();
</script>

{node.text}
