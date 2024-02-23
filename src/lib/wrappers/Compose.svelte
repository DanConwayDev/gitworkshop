<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { reply_kind, repo_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user } from '$lib/stores/users'
  import { selected_repo } from '$lib/stores/repo'
  import Compose from '$lib/components/events/Compose.svelte'
  import { selected_proposal_full } from '$lib/stores/Proposal'

  export let reply_to_event_id = ''

  let repo_id: string
  let proposal_id: string

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    repo_id = $selected_repo.repo_id
    proposal_id = $selected_proposal_full.summary.id

    edit_mode = repo_id.length > 0 && proposal_id.length > 0 && !submitted
  }

  async function sendReply(content: string) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = reply_kind
    event.tags.push(['e', proposal_id, 'root'])
    if (reply_to_event_id.length > 0) {
      event.tags.push(['e', reply_to_event_id, 'reply'])
    }
    if ($selected_repo.unique_commit) {
      event.tags.push(['r', $selected_repo.unique_commit])
    }
    event.tags.push([
      'a',
      `${repo_kind}:${$selected_repo.maintainers[0].hexpubkey}:${repo_id}`,
    ])
    $selected_repo.maintainers.forEach((m) =>
      event.tags.push(['p', m.hexpubkey])
    )
    // TODO nip-10 reply chain p tags
    event.content = content
    submitting = true
    let relays = [...$selected_repo.relays]
    try {
      event.sign()
    } catch {
      alert('failed to sign event')
    }
    try {
      let user_relays = await getUserRelays($logged_in_user.hexpubkey)
      relays = [
        ...relays,
        ...(user_relays.ndk_relays
          ? user_relays.ndk_relays.writeRelayUrls
          : []),
        // TODO: proposal event pubkey relays
      ]
    } catch {
      alert('failed to get user relays')
    }
    try {
      let _ = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      submitting = false
      submitted = true
      setTimeout(() => {
        submitted = false
      }, 5000)
    } catch {}
  }
</script>

{#if edit_mode}
  <Compose {sendReply} {submitting} logged_in={!!$logged_in_user} />
{/if}
{#if submitted}
  <div>sent!</div>
{/if}
