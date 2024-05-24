<script lang="ts">
  import EventWrapper from '$lib/components/events/EventWrapper.svelte'
  import EventWrapperLite from '$lib/components/events/EventWrapperLite.svelte'
  import Status from '$lib/components/events/content/Status.svelte'
  import Patch from '$lib/components/events/content/Patch.svelte'
  import ParsedContent from '$lib/components/events/content/ParsedContent.svelte'
  import { defaults as user_defaults } from '$lib/components/users/type'
  import { patch_kind, proposal_status_kinds } from '$lib/kinds'
  import { ensureUser } from '$lib/stores/users'
  import { NDKRelaySet, type NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy, onMount } from 'svelte'
  import { get, writable, type Unsubscriber, type Writable } from 'svelte/store'
  import {
    extractPatchMessage,
    isCoverLetter,
    isParsedNaddr,
    type ParsedNaddr,
    type ParsedNevent,
    type ParsedNote,
  } from '$lib/components/events/content/utils'
  import { base_relays, ndk } from '$lib/stores/ndk'
  import EventCard from './EventCard.svelte'

  export let parsed_nostr_ref: ParsedNaddr | ParsedNevent | ParsedNote

  let cannot_find_event = false;
  let event: Writable<undefined | NDKEvent> = writable(undefined)

  onMount(() => {
    let sub = ndk.subscribe(
      isParsedNaddr(parsed_nostr_ref) ? {
        '#a': [`${parsed_nostr_ref.kind}:${parsed_nostr_ref.pubkey}:${parsed_nostr_ref.identifier}`],
      } :
      { ids: [parsed_nostr_ref.id] },
      {closeOnEose: true},
      NDKRelaySet.fromRelayUrls([ ...base_relays, ...parsed_nostr_ref.relays ], ndk)
    )

    sub.on('event', (e: NDKEvent) => {
      event.set(e)
    })

    sub.on('eose', () => {
      if (!get(event)) cannot_find_event = true
    })
  })
</script>

  <div class="card shadow-xl border border-base-400 p-2 pt-0 my-3">
    {#if $event && $event.pubkey}
      <EventCard event={$event} />
    {:else if cannot_find_event}
      cannot find event
    {:else}
      loading...
    {/if}
  </div>

