<script lang="ts">
	import { type NostrEvent } from 'nostr-tools';
	import { getTagValue } from 'applesauce-core/helpers';
	import { extractPatchMessage } from '$lib/git-utils';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ChangesToFiles from '../explorer/ChangesToFiles.svelte';

	let { event }: { event: NostrEvent } = $props();

	let commit_id_shorthand = getTagValue(event, 'commit')?.substring(0, 8) || '[commit_id unknown]';
	let commit_message =
		getTagValue(event, 'description') || extractPatchMessage(event.content) || '[untitled]';
	let commit_message_node = $derived(
		nostrEventToDocTree({ content: commit_message, tags: [] } as unknown as NostrEvent, true)
	);
</script>

<div class="">
	<div class="bg-base-300 flex rounded-t p-1">
		<article class="prose prose-p:text-sm ml-2 max-w-4xl grow font-mono break-words">
			<ContentTree node={commit_message_node} />
		</article>
	</div>

	<div class="flex p-3">
		<div class="grow text-xs">Changes:</div>
		<div class="flex-none text-right font-mono text-xs">
			{commit_id_shorthand}
		</div>
	</div>
	<ChangesToFiles diff={event.content} />
</div>
