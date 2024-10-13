<script lang="ts">
  import { type Event } from 'nostr-tools'
  import { writable, type Writable } from 'svelte/store'
  import EventCard from './EventCard.svelte'
  import type { AddressPointer, EventPointer } from 'nostr-tools/nip19'
  import { repo_kind } from '$lib/kinds'
  import EventWrapperLite from '$lib/components/events/EventWrapperLite.svelte'
  import Repo from '$lib/components/events/content/Repo.svelte'
  import { getRepoCollectionObservable } from '$lib/stores/repo'

  export let pointer: AddressPointer | EventPointer

  let cannot_find_event = false
  let event: Writable<undefined | Event> = writable(undefined)

  const isAddressPointer = (
    pointer: AddressPointer | EventPointer
  ): pointer is AddressPointer => {
    return Object.keys(pointer).includes('identifier')
  }
  let is_repo = isAddressPointer(pointer) && pointer.kind == repo_kind
  $: repo =
    is_repo && isAddressPointer(pointer)
      ? getRepoCollectionObservable(
          `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`
        )
      : writable(undefined)
  // TODO: fetch event
  // onMount(() => {
  //   if (!is_repo) {
  //     let sub = ndk.subscribe(
  //       isAddressPointer(pointer)
  //         ? {
  //             '#a': [`${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`],
  //           }
  //         : { ids: [pointer.id] },
  //       { closeOnEose: true },
  //       NDKRelaySet.fromRelayUrls(
  //         pointer.relays ? [...base_relays, ...pointer.relays] : base_relays,
  //         ndk
  //       )
  //     )

  //     sub.on('event', (e: NDKEvent) => {
  //       event.set(e)
  //     })

  //     sub.on('eose', () => {
  //       if (!get(event)) cannot_find_event = true
  //     })
  //   }
  // })
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
