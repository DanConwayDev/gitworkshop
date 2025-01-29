<script lang="ts">
	import type { NodeViewProps } from '@tiptap/core';
	import { NodeViewWrapper } from 'svelte-tiptap';
	import type { NEventNode } from 'nostr-editor';
	import EmbeddedEvent from './EmbeddedEvent.svelte';

	let { node, selected }: NodeViewProps = $props();
</script>

<NodeViewWrapper class="inline-block">
	<EmbeddedEvent nevent_attr={(node as unknown as NEventNode).attrs} edit_mode={{ selected }} />
</NodeViewWrapper>
