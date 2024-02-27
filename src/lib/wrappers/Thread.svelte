<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import EventCard from './EventCard.svelte'
  import ThreadWrapper from '$lib/components/events/ThreadWrapper.svelte'
  import { writable } from 'svelte/store'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'

  export let replies: NDKEvent[] | undefined = undefined

  let replies_store = replies
    ? writable(replies)
    : ndk.storeSubscribe({
        '#e': [event.id],
      })
  $: {
    if (replies) replies_store.set(replies)
  }
</script>

<EventCard {type} {event} />

<ThreadWrapper>
  {#each $replies_store as event}
    <EventCard {type} {event} />
  {/each}
</ThreadWrapper>
