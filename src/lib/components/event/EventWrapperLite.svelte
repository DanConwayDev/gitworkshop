<script lang="ts">
	import type { Snippet } from 'svelte';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import type { NEventAttributes } from 'nostr-editor';
	import type { NostrEvent } from 'nostr-tools';
	let {
		nevent_attr,
		event,
		children
	}: { event?: NostrEvent; nevent_attr?: NEventAttributes; children?: Snippet } = $props();

	let author = $derived(event ? event.pubkey : (nevent_attr?.author ?? undefined));
	let created_at = $derived(event?.created_at ?? undefined);
</script>

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
	<div class="flex">
		<div class="flex-auto">
			<div class="inline text-neutral-400">
				{@render children?.()}
			</div>
			<div class="badge bg-base-400 text-neutral-400">
				<UserHeader user={author} inline />
			</div>
		</div>
		{#if created_at}<span class="m-auto flex-none py-1 text-xs"
				><FromNow unix_seconds={created_at} /></span
			>{/if}
	</div>
</div>
