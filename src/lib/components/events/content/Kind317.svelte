<script lang="ts">
  import type { NDKTag } from '@nostr-dev-kit/ndk'
  import parseDiff from 'parse-diff'
  import ParsedContent from './ParsedContent.svelte'

  export let content: string = ''
  export let tags: NDKTag[] = []

  let commit_id = extractTagContent('commit') || '[unknown commit_id]'
  let commit_message = extractTagContent('description') || '[untitled]'

  let files = parseDiff(content)
  function extractTagContent(name: string): string | undefined {
    let tag = tags.find((tag) => tag[0] === name)
    return tag ? tag[1] : undefined
  }
</script>

<div class="">
  <div class="flex rounded-t bg-base-300 p-1">
    <article class="prose ml-2 flex-grow font-mono">
      <ParsedContent content={commit_message} />
    </article>
    <div class="flex-none p-1 align-middle text-xs text-neutral">commit</div>
  </div>

  <div class="rounded-b bg-base-200 p-1">
    <table class="table table-zebra table-xs">
      <tr>
        <td class="text-xs">Changes: </td>
        <td class="text-right">
          <span class="font-mono text-xs">{commit_id.substring(0, 8)}</span>
        </td>
      </tr>
      {#each files as file}
        <tr>
          <td>
            <span
              class:text-success={file.new}
              class:text-error={file.deleted}
              class="text-success"
            >
              {file.to || file.from}
            </span>
          </td>
          <td class="text-right">
            <span class="text-success">+{file.additions}</span>
            <span class="text-error">- {file.deletions}</span>
          </td>
        </tr>
      {/each}
    </table>
  </div>
</div>
