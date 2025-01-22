<script lang="ts">
	import type { NodeViewProps } from '@tiptap/core';
	import { NodeViewWrapper } from 'svelte-tiptap';
	import UserHeader from '../user/UserHeader.svelte';

	let { node, selected }: NodeViewProps = $props();
</script>

<NodeViewWrapper class="inline-block">
	<span class:border-neutral-content={selected} class="badge badge-neutral">
		<UserHeader user={node.attrs.pubkey} inline={true} link_to_profile={false} size="sm" />
	</span>
</NodeViewWrapper>
