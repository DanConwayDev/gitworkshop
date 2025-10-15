<script lang="ts">
	import parseDiff from 'parse-diff';
	import hljs from 'highlight.js/lib/common';
	import 'highlight.js/styles/agate.min.css';
	import type { Change, AddChange, DeleteChange } from 'parse-diff';
	import { icons_misc } from '$lib/icons';

	let { diff }: { diff: string } = $props();

	let files = $derived(parseDiff(diff));

	// svelte-ignore state_referenced_locally
	let expand_files = $state(files.map(() => false));
	// svelte-ignore state_referenced_locally
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

<div class="w-full">
	{#each files as file, index (index)}
		<div
			class="border-base-300 my-2 border {expand_full_files[index]
				? 'bg-base-300 absolute left-0 z-10 w-screen px-5'
				: ''}"
		>
			<div class="bg-base-200 flex w-full">
				<button
					class="flex items-center justify-center p-2 text-right text-xs opacity-40"
					onclick={() => {
						expand_files[index] = !expand_files[index];
						expand_full_files[index] = false;
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 12 12"
						class="fill-base-content h-4 w-4"
					>
						{#each icons_misc[expand_files[index] ? 'arrow_down_12' : 'arrow_right_12'] as d (d)}
							<path {d} />
						{/each}
					</svg>
				</button>
				<button
					class="flex shrink grow p-3 pl-0 text-sm"
					onclick={() => {
						if (expand_full_files[index]) {
							expand_full_files[index] = false;
							expand_files[index] = false;
						} else if (expand_files[index]) {
							expand_files[index] = false;
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
					class="flex-none px-3 text-right text-xs opacity-40"
					onclick={() => {
						expand_full_files[index] = !expand_full_files[index];
						if (expand_full_files[index]) expand_files[index] = true;
					}}
					title="full width"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						class="fill-base-content h-6 w-6"
					>
						{#each icons_misc[expand_files[index] ? 'expand_width_24' : 'expand_width_24'] as d (d)}
							<path {d} />
						{/each}
					</svg>
				</button>
			</div>
			{#if expand_files[index]}
				<div class="border-base-300 flex border-t font-mono text-xs">
					<div class="flex-full text-right select-none">
						{#each file.chunks as chunk, index (index)}
							{#if index !== 0}
								<div class="bg-base-200 flex w-full">
									<div class="w-8 flex-none pt-1 pr-2 pb-2 whitespace-pre opacity-50">...</div>
								</div>
							{/if}
							{#each chunk.changes as change, i (i)}
								<div class="bg-base-100 flex w-full">
									<div
										class="w-8 flex-none whitespace-pre {change.type == 'add'
											? 'bg-success/50'
											: change.type == 'del'
												? 'bg-error/50'
												: 'bg-base-alt-300'} pr-2 opacity-50"
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
						<div class="w-fit min-w-full">
							{#each file.chunks as chunk, index (index)}
								{#if index !== 0}
									<div class="bg-base-200 flex h-7 w-full"></div>
								{/if}
								{#each chunk.changes as change, i (i)}
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
				{#each file.chunks as chunk, index (index)}
					{#if index !== 0}
						<span class="block h-7 p-3"> </span>
					{/if}
					{#each Array.from(chunk.changes.keys()) as i (i)}
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
