<script lang="ts">
	import type { CommitInfo } from '$lib/types/git-manager';
	import { pr_icon_path } from './icons';
	import { nostrEventToDocTree } from '$lib/doc_tree';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import type { NostrEvent } from 'nostr-tools';
	import ChangesToFiles from '../explorer/ChangesToFiles.svelte';
	import { onMount } from 'svelte';
	import git_manager from '$lib/git-manager';

	let { info, event_id_ref_hint }: { info: CommitInfo; event_id_ref_hint?: string } = $props();

	let commit_title = $derived(info.message.split(/[\r\n]/)[0]);

	let commit_msg_after_title = $derived(
		info.message.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').slice(1).join('\n')
		// info.message
	);

	let commit_message_node = $derived(
		nostrEventToDocTree(
			{
				content: commit_msg_after_title,
				tags: []
			} as unknown as NostrEvent,
			true
		)
	);

	let diff: string | undefined = $state();
	onMount(async () => {
		let git_diff = await git_manager.getCommitDiff(info.oid, event_id_ref_hint);
		diff = git_diff;
	});
</script>

<div class="bg-base-300 border-base-400 my-2 rounded border border-2">
	<div class="bg-base-400 flex items-center gap-2 rounded p-2">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 16 16"
			class="text-base-content h-4 w-4 flex-none"
		>
			<title>Commit</title>
			<path fill="currentColor" d={pr_icon_path.commit} />
		</svg>

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<div class=" flex-grow truncate font-medium">
					{commit_title}
				</div>
				{#if info.author.name}
					<div class="text-base-content/50 shrink-0 text-xs">{info.author.name}</div>
				{/if}
			</div>
		</div>

		<div class="commit-id text-base-content/40 ml-2 flex-shrink-0 text-xs">
			{info.oid.substring(0, 8)}
		</div>
	</div>
	{#if commit_msg_after_title.length > 0}
		<div class="p-2">
			<article class="prose prose-p:text-sm ml-2 max-w-4xl grow pt-3 font-mono break-words">
				<ContentTree node={commit_message_node} />
			</article>
		</div>
	{/if}
	<div class="flex w-full rounded-t p-2">
		{#if diff}
			<ChangesToFiles {diff} />
		{/if}
	</div>
</div>
