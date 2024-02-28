<script lang="ts">
  import EventWrapper from '$lib/components/events/EventWrapper.svelte'
  import Status from '$lib/components/events/content/Status.svelte'
  import Patch from '$lib/components/events/content/Patch.svelte'
  import ParsedContent from '$lib/components/events/content/ParsedContent.svelte'
  import { defaults as user_defaults } from '$lib/components/users/type'
  import { patch_kind, proposal_status_kinds } from '$lib/kinds'
  import { ensureUser } from '$lib/stores/users'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'
  import { writable, type Unsubscriber } from 'svelte/store'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'

  let author = writable({ ...user_defaults })
  let author_unsubsriber: Unsubscriber
  $: {
    if (event && event.pubkey.length > 0)
      author_unsubsriber = ensureUser(event.pubkey).subscribe((u) => {
        if (u.hexpubkey == event.pubkey) author.set({ ...u })
      })
  }
  onDestroy(() => {
    if (author_unsubsriber) author_unsubsriber()
  })
</script>

<EventWrapper {type} author={$author} created_at={event.created_at} {event}>
  {#if event.kind == patch_kind}
    <Patch content={event.content} tags={event.tags} />
  {:else if event.kind && proposal_status_kinds.includes(event.kind)}
    <Status {type} status={event.kind} />
  {:else}
    <ParsedContent content={event.content} tags={event.tags} />
  {/if}
</EventWrapper>
