<script lang="ts">
  import { aRefToAddressPointer } from '$lib/components/repo/utils'
  import { nip19, type Event } from 'nostr-tools'
  import { extractIssueTitle, extractRepoAFromProposalEvent } from './utils'

  export let event: Event
  let nevent = nip19.neventEncode({
    id: event.id,
    relays: undefined,
  })
  let a_string = extractRepoAFromProposalEvent(event)
  let pointer = a_string ? aRefToAddressPointer(a_string) : undefined
  let naddr = pointer ? nip19.naddrEncode(pointer) : undefined
</script>

<span>
  Git Issue for <a class="opacity-50" href={`/e/${naddr}`}
    >{pointer?.identifier}</a
  >: <a href={`/e/${nevent}`}>{extractIssueTitle(event)}</a> by
</span>
