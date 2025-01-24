<script lang="ts">
	import type { NodeViewProps } from '@tiptap/core';
	import { NodeViewWrapper } from 'svelte-tiptap';
	import Mention from './Mention.svelte';
	import type { NProfileNode } from 'nostr-editor';

	let { node, selected }: NodeViewProps = $props();
</script>

<NodeViewWrapper class="inline-block">
	<Mention node={node as unknown as NProfileNode} edit_mode={{ selected }} />
</NodeViewWrapper>
