<script lang="ts">
	import type { NodeViewProps } from '@tiptap/core';
	import { NodeViewWrapper } from 'svelte-tiptap';
	import type { NAddrNode, NEventNode } from 'nostr-editor';
	import EmbeddedEvent from './EmbeddedEvent.svelte';

	let { node, selected }: NodeViewProps = $props();
</script>

<NodeViewWrapper class="inline-block">
	<EmbeddedEvent
		n_attr={(node as unknown as NEventNode | NAddrNode).attrs}
		edit_mode={{ selected }}
	/>
</NodeViewWrapper>
