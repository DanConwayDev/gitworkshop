<script lang="ts">
  import { base_relays, ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { reply_kind, repo_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user } from '$lib/stores/users'
  import {
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import Compose from '$lib/components/events/Compose.svelte'
  import { selected_proposal_full } from '$lib/stores/Proposal'
  import { selected_issue_full } from '$lib/stores/Issue'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let reply_to_event_id = ''
  let repo_identifier: string
  let proposal_or_issue_id: string

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    repo_identifier = $selected_repo_collection.identifier
    selected_issue_full
    proposal_or_issue_id = (
      type === 'proposal' ? $selected_proposal_full : $selected_issue_full
    ).summary.id

    edit_mode =
      repo_identifier.length > 0 &&
      proposal_or_issue_id.length > 0 &&
      !submitted
  }

  async function sendReply(content: string) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = reply_kind
    event.tags.push(['e', proposal_or_issue_id, 'root'])
    if (reply_to_event_id.length > 0) {
      event.tags.push(['e', reply_to_event_id, 'reply'])
    }
    if ($selected_repo_event.unique_commit) {
      event.tags.push(['r', $selected_repo_event.unique_commit])
    }
    event.tags.push([
      'a',
      `${repo_kind}:${$selected_repo_event.maintainers[0].hexpubkey}:${repo_identifier}`,
    ])
    $selected_repo_event.maintainers.forEach((m) =>
      event.tags.push(['p', m.hexpubkey])
    )
    // TODO nip-10 reply chain p tags
    event.content = content
    submitting = true
    let relays = [
      ...($selected_repo_event.relays.length > 3
        ? $selected_repo_event.relays
        : [...base_relays].concat($selected_repo_event.relays)),
    ]

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
