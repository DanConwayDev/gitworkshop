<script lang="ts">
  import { NDKRelaySet, type NDKEvent } from '@nostr-dev-kit/ndk'
  import { onMount } from 'svelte'
  import { get, writable, type Writable } from 'svelte/store'
  import { base_relays, ndk } from '$lib/stores/ndk'
  import EventCard from './EventCard.svelte'
  import type {
    AddressPointer,
    EventPointer,
  } from 'nostr-tools/lib/types/nip19'
  import { repo_kind } from '$lib/kinds'
  import { ensureRepo } from '$lib/stores/repos'
  import EventWrapperLite from '$lib/components/events/EventWrapperLite.svelte'
  import Repo from '$lib/components/events/content/Repo.svelte'

  export let pointer: AddressPointer | EventPointer

  let cannot_find_event = false
  let event: Writable<undefined | NDKEvent> = writable(undefined)

  const isAddressPointer = (
    pointer: AddressPointer | EventPointer
  ): pointer is AddressPointer => {
    return Object.keys(pointer).includes('identifier')
  }
  let is_repo = isAddressPointer(pointer) && pointer.kind == repo_kind
  let repo =
    is_repo && isAddressPointer(pointer)
      ? ensureRepo(`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`)
      : undefined

  onMount(() => {
    if (!is_repo) {
      let sub = ndk.subscribe(
        isAddressPointer(pointer)
          ? {
              '#a': [`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`],
            }
          : { ids: [pointer.id] },
        { closeOnEose: true },
        NDKRelaySet.fromRelayUrls(
          pointer.relays ? [...base_relays, ...pointer.relays] : base_relays,
          ndk
        )
      )

      sub.on('event', (e: NDKEvent) => {
        event.set(e)
      })

      sub.on('eose', () => {
        if (!get(event)) cannot_find_event = true
      })
    }
  })
</script>

<div class="card my-3 border border-base-400 shadow-xl">
  {#if repo && $repo}
    <EventWrapperLite author={$repo?.author} created_at={$repo?.created_at}>
      <Repo event={$repo} />
    </EventWrapperLite>
  {:else if $event && $event.pubkey}
    <div class="p-2 pt-0">
      <EventCard event={$event} preview={true} />
    </div>
  {:else if cannot_find_event}
    <div class="m-3 text-center text-sm">cannot find event</div>
  {:else}
    <div class="m-3 text-center text-sm">loading...</div>
  {/if}
</div>
