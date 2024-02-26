<script lang="ts">
  import type { NDKTag } from '@nostr-dev-kit/ndk'
  import parseDiff from 'parse-diff'
  import hljs from 'highlight.js/lib/common'
  import 'highlight.js/styles/agate.min.css'
  import type { Change, AddChange, DeleteChange } from 'parse-diff'
  import ParsedContent from './ParsedContent.svelte'
  import { extractPatchMessage } from './utils'

  export let content: string = ''
  export let tags: NDKTag[] = []
  let commit_id_shorthand =
    extractTagContent('commit')?.substring(0, 8) || '[commit_id unknown]'
  let commit_message =
    extractTagContent('description') ||
    extractPatchMessage(content) ||
    '[untitled]'

  let files = parseDiff(content)
  let expand_files = files.map((file) => file.deletions + file.additions < 20)

  if (
    files.reduce((acc, file) => acc + file.deletions + file.additions, 0) < 60
  ) {
    expand_files = expand_files.map((_) => true)
  }

  function extractTagContent(name: string): string | undefined {
    let tag = tags.find((tag) => tag[0] === name)
    return tag ? tag[1] : undefined
  }

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
</script>

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
    <div class="my-2 border border-base-300">
      <button
        class=" 400 flex w-full bg-base-200 p-3"
        on:click={() => {
          expand_files[index] = !expand_files[index]
        }}
      >
        <div class="flex-none text-sm">
          <span>
            {file.to || file.from}
          </span>
          <span
            class="text-middle flex-none pl-3 align-middle font-mono text-xs opacity-70"
          >
            {#if file.new}
              <span>created file</span>
            {/if}
            {#if file.deleted}
              <span>deleted file</span>
            {/if}
            {#if !file.deleted}
              <span class="text-success">+{file.additions}</span>
            {/if}
            {#if !file.new}
              <span class="text-error">-{file.deletions}</span>
            {/if}
          </span>
        </div>
        <div class="flex-grow text-right text-xs opacity-40">
          {expand_files[index] ? 'colapse' : 'expand'}
        </div>
      </button>
      {#if expand_files[index]}
        <div class="border-t-1 border-base-300">
          {#each file.chunks as chunk, index}
            <div class="overflow-x-auto">
              {#if index !== 0}
                <div class="text-middle h-6 bg-base-200 font-mono text-xs">
                  <div
                    class="w-8 flex-none select-none pr-2 text-right opacity-50"
                  >
                    ...
                  </div>
                </div>
              {/if}
              {#each chunk.changes as change, i}
                <div class="flex w-full bg-base-100 font-mono text-xs">
                  <div
                    class="w-8 flex-none select-none {change.type == 'add'
                      ? 'bg-success/30'
                      : change.type == 'del'
                        ? 'bg-error/30'
                        : 'bg-slate-500/20'} pr-2 text-right opacity-50"
                  >
                    {isAddChange(change) &&
                    i !== 0 &&
                    isDeleteChange(chunk.changes[i - 1])
                      ? ''
                      : extractChangeLine(change)}
                  </div>
                  <div
                    class="w-full flex-grow whitespace-pre {change.type == 'add'
                      ? 'bg-success/10'
                      : change.type == 'del'
                        ? 'bg-error/10'
                        : ''}"
                  >
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html hljs.highlight(
                      change.type == 'normal'
                        ? change.content
                        : change.content.substring(1),
                      {
                        language:
                          (file.to || file.from)?.split('.').pop() || '',
                      }
                    ).value}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
