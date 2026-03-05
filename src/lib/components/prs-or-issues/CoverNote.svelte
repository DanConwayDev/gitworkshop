<script lang="ts">
	import type { IssueOrPRTableItem } from '$lib/types';
	import type { NostrEvent } from 'nostr-tools';
	import { CoverNoteKind } from '$lib/kinds';
	import { isAuthorisedForItem } from '$lib/processors/Issue';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import UserHeader from '../user/UserHeader.svelte';
	import FromNow from '../FromNow.svelte';

	let {
		table_item,
		thread_events
	}: {
		table_item: IssueOrPRTableItem;
		thread_events: NostrEvent[];
	} = $props();

	let covernote: NostrEvent | undefined = $derived.by(() => {
		const candidates = thread_events.filter(
			(e) =>
				e.kind === CoverNoteKind &&
				e.tags.some((t) => t[0] === 'e' && t[1] === table_item.uuid) &&
				isAuthorisedForItem(table_item, e.pubkey)
		);
		if (candidates.length === 0) return undefined;
		return candidates.reduce((latest, e) => (e.created_at > latest.created_at ? e : latest));
	});

	let node = $derived(covernote ? nostrEventToDocTree(covernote, true) : undefined);
</script>

{#if covernote && node}
	<div class="bg-base-200 border-l-info mt-2 mb-4 border-l-4 px-4 py-3">
		<div class="text-base-content/60 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<!-- https://icon-sets.iconify.design/ph/push-pin-fill/ -->
			<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" viewBox="0 0 256 256">
				<path
					fill="currentColor"
					d="M235.33 104L152 20.69a16 16 0 0 0-22.64 0l-36.69 36.68a16 16 0 0 0 0 22.64l20.69 20.69l-55 55H24a8 8 0 0 0-5.66 13.66l72 72A8 8 0 0 0 96 240v-34.34l55-55l20.69 20.69a16 16 0 0 0 22.63 0l36.69-36.69a16 16 0 0 0 .32-22.66"
				/>
			</svg>
			<span class="font-medium tracking-wide uppercase">Cover note</span>
			<span class="text-base-content/30">by</span>
			<UserHeader user={covernote.pubkey} inline size="xs" />
			<span class="text-base-content/30">&middot;</span>
			<FromNow unix_seconds={covernote.created_at} />
		</div>
		<div class="prose prose-sm max-w-none">
			<ContentTree {node} />
		</div>
	</div>
{/if}
