<script lang="ts">
	import UserHeader from '../user/UserHeader.svelte';
	import type { NProfileNode } from 'nostr-editor';

	let { node, edit_mode }: { node: NProfileNode; edit_mode?: { selected: boolean } } = $props();
</script>

<span class:border-neutral-content={edit_mode?.selected} class="badge badge-neutral">
	<UserHeader user={node.attrs.pubkey} inline={true} link_to_profile={!edit_mode} size="sm" />
</span>
