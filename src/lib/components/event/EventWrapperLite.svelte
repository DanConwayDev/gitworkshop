<script lang="ts">
	import type { Snippet } from 'svelte';
	import FromNow from '../FromNow.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import type { NAddrAttributes, NEventAttributes } from 'nostr-editor';
	import type { NostrEvent } from 'nostr-tools';
	let {
		n_attr,
		event,
		disable_links = false,
		name_first = false,
		children
	}: {
		event?: NostrEvent;
		n_attr?: NEventAttributes | NAddrAttributes;
		disable_links?: boolean;
		name_first: boolean;
		children?: Snippet;
	} = $props();

	let author = $derived(
		event ? event.pubkey : n_attr?.type === 'naddr' ? n_attr.pubkey : (n_attr?.author ?? undefined)
	);
	let created_at = $derived(event?.created_at ?? undefined);
</script>

<div class="max-w-4xl border-b border-base-300 p-3 pl-3">
	<div class="flex">
		<div class="flex-auto">
			{#if !name_first}
				<div class="inline text-neutral-400">
					{@render children?.()}
				</div>
			{/if}
			<div class="badge bg-base-400 text-neutral-400">
				<UserHeader user={author} inline link_to_profile={!disable_links} />
			</div>
			{#if name_first}
				<div class="inline text-neutral-400">
					{@render children?.()}
				</div>
			{/if}
		</div>
		{#if created_at}<span class="m-auto flex-none py-1 text-xs"
				><FromNow unix_seconds={created_at} /></span
			>{/if}
	</div>
</div>
