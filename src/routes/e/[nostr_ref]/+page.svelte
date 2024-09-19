<script lang="ts">
  import { nip19 } from 'nostr-tools'
  import Container from '$lib/components/Container.svelte'
  import { goto } from '$app/navigation'
  import { issue_kind, patch_kind, repo_kind } from '$lib/kinds'
  import { base_relays, ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { aToNaddr } from '$lib/components/repo/utils'
  import { ensureIssueFull } from '$lib/stores/Issue'
  import { ensureProposalFull } from '$lib/stores/Proposal'
  import AlertError from '$lib/components/AlertError.svelte'

  export let data: { nostr_ref: string }

  let error = false
  let error_msg =
    'reference in URL is not a repository, proposal, issue or npub reference'
  let waited = false

  const showError = (msg?: string) => {
    if (msg) error_msg = msg
    error = true
    waited = true
  }

  let lookupEvent = (id: string, relays: string[] | undefined = undefined) => {
    let sub = ndk.subscribe(
      {
        ids: [id],
        limit: 100,
      },
      {
        closeOnEose: false,
      },
      NDKRelaySet.fromRelayUrls([...base_relays, ...(relays || [])], ndk)
    )

    sub.on('event', (event: NDKEvent) => {
      try {
        if (event.id == id) {
          let a = event.tagValue('a')
          if (!a) {
            showError(
              'found event but it contains an invalid "a" tag reference'
            )
          } else {
            if (event.kind === issue_kind) {
              ensureIssueFull(a, event)
              goto(`/r/${aToNaddr(a)}/issues/${nip19.noteEncode(id)}`)
            } else if (event.kind === patch_kind) {
              ensureProposalFull(a, event)
              goto(`/r/${aToNaddr(a)}/proposals/${nip19.noteEncode(id)}`)
            } else {
              showError()
            }
          }
        }
      } catch {}
    })

    sub.on('eose', () => {
      showError('cannot find event')
    })
  }

  $: {
    try {
      let decoded = nip19.decode(data.nostr_ref)
      if (decoded.type === 'npub' || decoded.type === 'nprofile')
        goto(`/p/${data.nostr_ref}`)
      else if (decoded.type === 'naddr' && decoded.data.kind === repo_kind) {
        goto(`/r/${data.nostr_ref}`)
      } else if (decoded.type === 'nrelay' || decoded.type === 'nsec') {
        showError()
      } else if (typeof decoded.data === 'string') {
        lookupEvent(decoded.data)
      } else if (
        (decoded.type === 'nevent' || decoded.type === 'note') &&
        // doesnt have a confirmed kind of something other than issue or patch
        !(
          decoded.data.kind &&
          [patch_kind, issue_kind].includes(decoded.data.kind)
        )
      ) {
        lookupEvent(decoded.data.id, decoded.data.relays)
      } else {
        showError()
      }
    } catch {
      try {
        nip19.noteEncode(data.nostr_ref) // will throw if invalid event id
        lookupEvent(data.nostr_ref)
      } catch {
        showError()
      }
    }
  }
</script>

<svelte:head>
  <title>GitWorkshop - ngit</title>
</svelte:head>

{#if error && waited}
  <Container>
    <AlertError>
      <div>Error! {error_msg}:</div>
      <div class="break-all">{data.nostr_ref}</div>
    </AlertError>
  </Container>
{:else}
  <Container>loading...</Container>
{/if}
