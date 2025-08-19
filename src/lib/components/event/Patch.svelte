<script lang="ts">
	import parseDiff from 'parse-diff';
	import hljs from 'highlight.js/lib/common';
	import 'highlight.js/styles/agate.min.css';
	import type { Change, AddChange, DeleteChange } from 'parse-diff';
	import { type NostrEvent } from 'nostr-tools';
	import { getTagValue } from 'applesauce-core/helpers';
	import { extractPatchMessage } from '$lib/git-utils';
	import ContentTree from '../content-tree/ContentTree.svelte';
	import { nostrEventToDocTree } from '$lib/doc_tree';

	let { event }: { event: NostrEvent } = $props();

	let commit_id_shorthand = getTagValue(event, 'commit')?.substring(0, 8) || '[commit_id unknown]';
	let commit_message =
		getTagValue(event, 'description') || extractPatchMessage(event.content) || '[untitled]';
	let commit_message_node = $derived(
		nostrEventToDocTree({ content: commit_message, tags: [] } as unknown as NostrEvent)
	);

	let files = parseDiff(event.content);
	let expand_files = $state(files.map(() => false));
	let expand_full_files = $state(files.map(() => false));

	let isAddChange = (change: Change): change is AddChange => change.type == 'add';
	let isDeleteChange = (change: Change): change is DeleteChange => change.type == 'del';
	let extractChangeLine = (change: Change, stage?: 'before' | 'after') => {
		if (isAddChange(change) || isDeleteChange(change)) {
			return change.ln;
		} else {
			if (stage === 'before') return change.ln1;
			if (stage === 'after') return change.ln2;
			if (change.ln2 === change.ln2) return change.ln1;
			return '#';
		}
	};
	let getFortmattedDiffHtml = (change: Change, language: string): string | undefined => {
		try {
			return hljs.highlight(
				change.type == 'normal' ? change.content : change.content.substring(1),
				{ language }
			).value;
		} catch {
			return undefined;
		}
	};
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

	{#each files as file, index}
		<div
			class="border-base-300 my-2 border {expand_full_files[index]
				? 'bg-base-300 absolute left-0 z-10 w-screen px-5'
				: ''}"
		>
			<div class="bg-base-200 flex w-full">
				<button
					class="flex shrink grow p-3 text-sm"
					onclick={() => {
						if (expand_full_files[index]) {
							expand_full_files[index] = false;
							expand_files[index] = false;
						} else if (expand_files[index]) {
							expand_full_files[index] = true;
						} else {
							expand_files[index] = true;
						}
					}}
					><div class="shrink text-left text-wrap">
						<span class="pr-3">{file.to || file.from}</span>
						<span class="text-middle flex-none align-middle font-mono text-xs opacity-70"
							>{#if file.new}<span>created&nbsp;file</span>&nbsp;{/if}{#if file.deleted}<span
									>deleted&nbsp;file</span
								>&nbsp;{/if}{#if !file.deleted}<span class="text-success">+{file.additions}</span
								>{/if}&nbsp;{#if !file.new}<span class="text-error">-{file.deletions}</span>{/if}
						</span>
					</div>
					<div class="grow"></div>
				</button>
				<button
					class="flex-none p-3 text-right text-xs opacity-40"
					onclick={() => {
						expand_files[index] = !expand_files[index];
						expand_full_files[index] = false;
					}}
				>
					{expand_files[index] ? 'collapse' : 'expand'}
				</button>
				<button
					class="flex-none p-3 text-right text-xs opacity-40"
					onclick={() => {
						expand_full_files[index] = !expand_full_files[index];
						if (expand_full_files[index]) expand_files[index] = true;
					}}
				>
					full
				</button>
			</div>
			{#if expand_files[index]}
				<div class="border-base-300 flex border-t font-mono text-xs">
					<div class="flex-full text-right select-none">
						{#each file.chunks as chunk, index}
							{#if index !== 0}
								<div class="bg-base-200 flex w-full">
									<div class="w-8 flex-none pt-1 pr-2 pb-2 whitespace-pre opacity-50">...</div>
								</div>
							{/if}
							{#each chunk.changes as change, i}
								<div class="bg-base-100 flex w-full">
									<div
										class="w-8 flex-none whitespace-pre {change.type == 'add'
											? 'bg-success/50'
											: change.type == 'del'
												? 'bg-error/50'
												: 'bg-slate-500/20'} pr-2 opacity-50"
										class:pt-3={index === 0 && i === 0}
										class:pb-3={index === file.chunks.length - 1 && i === chunk.changes.length - 1}
									>
										{isAddChange(change) && i !== 0 && isDeleteChange(chunk.changes[i - 1])
											? ' '
											: extractChangeLine(change)}
									</div>
								</div>
							{/each}
						{/each}
					</div>
					<div class="flex-auto overflow-x-auto">
						<div class="w-fit">
							{#each file.chunks as chunk, index}
								{#if index !== 0}
									<div class="bg-base-200 flex h-7 w-full"></div>
								{/if}
								{#each chunk.changes as change, i}
									<div class="bg-base-100 flex w-full">
										<div
											class="w-full grow whitespace-pre {change.type == 'add'
												? 'bg-success/20'
												: change.type == 'del'
													? 'bg-error/20'
													: ''}"
											class:pt-3={index === 0 && i === 0}
											class:pb-3={index === file.chunks.length - 1 &&
												i === chunk.changes.length - 1}
										>
											{#if getFortmattedDiffHtml(change, (file.to || file.from)
													?.split('.')
													.pop() || '')}
												<!-- eslint-disable-next-line svelte/no-at-html-tags -->
												{@html getFortmattedDiffHtml(
													change,
													(file.to || file.from)?.split('.').pop() || ''
												)}
											{:else}
												{change.type == 'normal' ? change.content : change.content.substring(1)}
											{/if}
											{#if (change.type == 'normal' ? change.content : change.content.substring(1)).length === 0}
												<!-- force empty line to have height -->
												<span></span>
											{/if}
										</div>
									</div>
								{/each}
							{/each}
						</div>
					</div>
				</div>
			{/if}
		</div>
		<!-- vertical padding for full width so that content retains it space -->
		{#if expand_full_files[index]}
			<div class="w-full font-mono text-xs whitespace-pre">
				<span class="block p-3 text-sm"> </span>
				{#each file.chunks as chunk, index}
					{#if index !== 0}
						<span class="block h-7 p-3"> </span>
					{/if}
					{#each Array.from(chunk.changes.keys()) as i}
						<span
							class="block"
							class:pt-3={index === 0 && i === 0}
							class:pb-3={index === file.chunks.length - 1 && i === chunk.changes.length - 1}
							>&nbsp;
						</span>
					{/each}
				{/each}
			</div>
		{/if}
	{/each}
</div>
