<script lang="ts">
  import { extractAReference } from '$lib/components/repo/utils'
  import { extractRepoAFromProposalEvent } from '$lib/stores/Proposals'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { nip19 } from 'nostr-tools'
  import { extractIssueTitle } from './utils'

  export let event: NDKEvent
  let nevent = nip19.neventEncode({
    id: event.id,
    relays: event.relay ? [event.relay.url] : undefined,
  })
  let a_string = extractRepoAFromProposalEvent(event)
  let pointer = a_string ? extractAReference(a_string) : undefined
  let naddr = pointer ? nip19.naddrEncode(pointer) : undefined
</script>

<span>
  Git Issue for <a class="opacity-50" href={`/e/${naddr}`}
    >{pointer?.identifier}</a
  >: <a href={`/e/${nevent}`}>{extractIssueTitle(event)}</a> by
</span>
