<script lang="ts">
  import type { NDKTag } from '@nostr-dev-kit/ndk'
  import {
    isImage,
    isParsedLink,
    isParsedNaddr,
    isParsedNevent,
    isParsedNewLine,
    isParsedNote,
    isParsedNprofile,
    isParsedNpub,
    isParsedText,
    parseContent,
    type ParsedPart,
  } from './utils'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import EventPreview from '$lib/wrappers/EventPreview.svelte'
  export let content: string = ''
  export let tags: NDKTag[] = []

  let fullContent: ParsedPart[] = []

  $: fullContent = parseContent(content, tags)
</script>

<div class="prose max-w-prose break-words">
  {#each fullContent as part}
    {#if isParsedNewLine(part)}
      {#if part.value.length > 1}
        <br />
      {/if}
      <br />
    {:else if isParsedLink(part)}
      {#if isImage(part.url)}
        <img src={part.url} alt={part.imeta?.alt} />
      {:else}
        <a href={part.url} target="_blank">
          {part.url.replace(/https?:\/\/(www\.)?/, '')}
        </a>
      {/if}
    {:else if isParsedNpub(part) || isParsedNprofile(part)}
      <div class="badge badge-neutral">
        <UserHeader user={part.hex} inline={true} size="sm" />
      </div>
    {:else if isParsedNevent(part) || isParsedNote(part) || isParsedNaddr(part)}
      <EventPreview parsed_nostr_ref={part} />
    {:else if isParsedText(part)}
      {part.value}
    {/if}
  {/each}
</div>
