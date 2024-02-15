<script lang="ts">
  import EventWrapper from '$lib/components/events/EventWrapper.svelte'
  import Kind19851985 from '$lib/components/events/content/Kind19851985.svelte'
  import Patch from '$lib/components/events/content/Patch.svelte'
  import ParsedContent from '$lib/components/events/content/ParsedContent.svelte'
  import { defaults as user_defaults } from '$lib/components/users/type'
  import { patch_kind, pr_status_kind } from '$lib/kinds'
  import { ensureUser } from '$lib/stores/users'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'
  import { writable } from 'svelte/store'

  export let event: NDKEvent

  let author = writable({ ...user_defaults })
  let author_unsubsriber = ensureUser(event.pubkey).subscribe((u) => {
    author.set({ ...u })
  })
  onDestroy(() => {
    author_unsubsriber()
  })
</script>

<EventWrapper
  author={$author}
  created_at={event.created_at}
  event_id={event.id}
  {event}
>
  {#if event.kind == patch_kind}
    <Patch content={event.content} tags={event.tags} />
  {:else if event.kind === pr_status_kind}
    <Kind19851985 tags={event.tags} />
  {:else}
    <ParsedContent content={event.content} tags={event.tags} />
  {/if}
</EventWrapper>
