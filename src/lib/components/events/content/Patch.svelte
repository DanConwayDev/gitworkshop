<script lang="ts">
  import parseDiff from 'parse-diff'
  import hljs from 'highlight.js/lib/common'
  import 'highlight.js/styles/agate.min.css'
  import type { Change, AddChange, DeleteChange } from 'parse-diff'
  import ParsedContent from './ParsedContent.svelte'
  import {
    extractPatchMessage,
    extractRepoAFromProposalEvent,
    extractTagContent,
  } from './utils'
  import { nip19, type Event } from 'nostr-tools'
  import { aRefToAddressPointer } from '$lib/components/repo/utils'

  export let event: Event
  export let preview = false

  let content: string = event ? event.content : ''
  let tags: string[][] = event ? event.tags : []

  let commit_id_shorthand =
    extractTagContent('commit', tags)?.substring(0, 8) || '[commit_id unknown]'
  let commit_message =
    extractTagContent('description', tags) ||
    extractPatchMessage(content) ||
    '[untitled]'
  let commit_title = commit_message.split('\n')[0]

  let files = parseDiff(content)
  let expand_files = files.map((file) => file.deletions + file.additions < 20)

  if (
    files.reduce((acc, file) => acc + file.deletions + file.additions, 0) < 60
  ) {
    expand_files = expand_files.map((_) => true)
  }

  let expand_full_files = files.map((_) => false)

  let isAddChange = (change: Change): change is AddChange =>
    change.type == 'add'
  let isDeleteChange = (change: Change): change is DeleteChange =>
    change.type == 'del'
  let extractChangeLine = (change: Change, stage?: 'before' | 'after') => {
    if (isAddChange(change) || isDeleteChange(change)) {
      return change.ln
    } else {
      if (stage === 'before') return change.ln1
      if (stage === 'after') return change.ln2
      if (change.ln2 === change.ln2) return change.ln1
      return '#'
    }
  }
  let getFortmattedDiffHtml = (
    change: Change,
    language: string
  ): string | undefined => {
    try {
      return hljs.highlight(
        change.type == 'normal' ? change.content : change.content.substring(1),
        { language }
      ).value
    } catch {
      return undefined
    }
  }
  $: nevent = nip19.neventEncode({
    id: event.id,
    relays: undefined,
  })

  let a_string = extractRepoAFromProposalEvent(event)
  let pointer = a_string ? aRefToAddressPointer(a_string) : undefined
  let naddr = pointer ? nip19.naddrEncode(pointer) : undefined
</script>

{#if preview}
  <span>
    Git Patch for <a class="opacity-50" href={`/e/${naddr}`}
      >{pointer?.identifier}</a
    >: <a href={`/e/${nevent}`}>{commit_title}</a> by
  </span>
{:else}
  <div class="">
    <div class="flex rounded-t bg-base-300 p-1">
      <article class="ml-2 flex-grow font-mono text-sm">
        <ParsedContent content={commit_message} />
      </article>
      <div class="flex-none p-1 align-middle text-xs text-neutral">commit</div>
    </div>

    <div class="flex p-3">
      <div class="flex-grow text-xs">Changes:</div>
      <div class="flex-none text-right font-mono text-xs">
        {commit_id_shorthand}
      </div>
    </div>

    {#each files as file, index}
      <div
        class="my-2 border border-base-300 {expand_full_files[index]
          ? 'absolute left-0 z-10 w-screen bg-base-300 px-5'
          : ''}"
      >
        <div class="flex w-full bg-base-200">
          <button
            class="flex shrink flex-grow p-3 text-sm"
            on:click={() => {
              if (expand_full_files[index]) {
                expand_full_files[index] = false
                expand_files[index] = false
              } else if (expand_files[index]) {
                expand_full_files[index] = true
              } else {
                expand_files[index] = true
              }
            }}
            ><div class="shrink text-wrap text-left">
              <span class="pr-3">{file.to || file.from}</span>
              <span
                class="text-middle flex-none align-middle font-mono text-xs opacity-70"
                >{#if file.new}<span>created&nbsp;file</span
                  >&nbsp;{/if}{#if file.deleted}<span>deleted&nbsp;file</span
                  >&nbsp;{/if}{#if !file.deleted}<span class="text-success"
                    >+{file.additions}</span
                  >{/if}&nbsp;{#if !file.new}<span class="text-error"
                    >-{file.deletions}</span
                  >{/if}
              </span>
            </div>
            <div class="flex-grow"></div>
          </button>
          <button
            class="flex-none p-3 text-right text-xs opacity-40"
            on:click={() => {
              expand_files[index] = !expand_files[index]
              expand_full_files[index] = false
            }}
          >
            {expand_files[index] ? 'colapse' : 'expand'}
          </button>
          <button
            class="flex-none p-3 text-right text-xs opacity-40"
            on:click={() => {
              expand_full_files[index] = !expand_full_files[index]
              if (expand_full_files[index]) expand_files[index] = true
            }}
          >
            full
          </button>
        </div>
        {#if expand_files[index]}
          <div class="border-t-1 flex border-base-300 font-mono text-xs">
            <div class="flex-full select-none text-right">
              {#each file.chunks as chunk, index}
                {#if index !== 0}
                  <div class="flex w-full bg-base-200">
                    <div
                      class="w-8 flex-none whitespace-pre pb-2 pr-2 pt-1 opacity-50"
                    >
                      ...
                    </div>
                  </div>
                {/if}
                {#each chunk.changes as change, i}
                  <div class="flex w-full bg-base-100">
                    <div
                      class="w-8 flex-none whitespace-pre {change.type == 'add'
                        ? 'bg-success/50'
                        : change.type == 'del'
                          ? 'bg-error/50'
                          : 'bg-slate-500/20'} pr-2 opacity-50"
                      class:pt-3={index === 0 && i === 0}
                      class:pb-3={index === file.chunks.length - 1 &&
                        i === chunk.changes.length - 1}
                    >
                      {isAddChange(change) &&
                      i !== 0 &&
                      isDeleteChange(chunk.changes[i - 1])
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
                    <div class="flex h-7 w-full bg-base-200"></div>
                  {/if}
                  {#each chunk.changes as change, i}
                    <div class="flex w-full bg-base-100">
                      <div
                        class="w-full flex-grow whitespace-pre {change.type ==
                        'add'
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
                          {change.type == 'normal'
                            ? change.content
                            : change.content.substring(1)}
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
        <div class="w-full whitespace-pre font-mono text-xs">
          <span class="block p-3 text-sm"> </span>
          {#each file.chunks as chunk, index}
            {#if index !== 0}
              <span class="block h-7 p-3"> </span>
            {/if}
            {#each chunk.changes as _, i}
              <span
                class="block"
                class:pt-3={index === 0 && i === 0}
                class:pb-3={index === file.chunks.length - 1 &&
                  i === chunk.changes.length - 1}
                >&nbsp;
              </span>
            {/each}
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/if}
