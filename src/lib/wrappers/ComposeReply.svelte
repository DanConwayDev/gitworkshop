<script lang="ts">
  import { base_relays, ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { reply_kind, repo_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user, user_relays } from '$lib/stores/users'
  import {
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import Compose from '$lib/components/events/Compose.svelte'
  import { selected_proposal_full } from '$lib/stores/Proposal'
  import { selected_issue_full } from '$lib/stores/Issue'
  import type { IssueFull } from '$lib/components/issues/type'
  import type { ProposalFull } from '$lib/components/proposals/type'
  import { get } from 'svelte/store'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let event: NDKEvent
  export let sentFunction = () => {}
  let repo_identifier: string
  let selected_proposal_or_issue: IssueFull | ProposalFull

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    repo_identifier = $selected_repo_collection.identifier
    selected_issue_full
    selected_proposal_or_issue =
      type === 'proposal' ? $selected_proposal_full : $selected_issue_full

    edit_mode =
      repo_identifier.length > 0 &&
      selected_proposal_or_issue.summary.id.length > 0 &&
      !submitted
  }
  /** to get the proposal revision id rather than the root proposal */
  const getRootId = (event: NDKEvent): string | undefined => {
    // exclude 'a' references to repo events
    return event.tags.find(
      (t) => t[0] === 'e' && t.length === 4 && t[3] === 'root'
    ) || event.tags.some((t) => t[0] === 't' && t[1] === 'root')
      ? event.id
      : undefined
  }

  async function sendReply(content: string) {
    if (!$logged_in_user) return
    let new_event = new NDKEvent(ndk)
    new_event.kind = reply_kind
    new_event.tags.push([
      'e',
      getRootId(event) || selected_proposal_or_issue.summary.id,
      $selected_repo_event.relays[0] || '',
      'root',
    ])
    if (event.id.length > 0) {
      new_event.tags.push([
        'e',
        event.id,
        $selected_repo_event.relays[0] || '',
        'reply',
      ])
    }
    if ($selected_repo_event.unique_commit) {
      new_event.tags.push(['r', $selected_repo_event.unique_commit])
    }
    new_event.tags.push([
      'a',
      `${repo_kind}:${$selected_repo_event.maintainers[0].hexpubkey}:${repo_identifier}`,
    ])
    let parent_event_user_relay = user_relays[event.pubkey]
      ? get(user_relays[event.pubkey]).ndk_relays?.writeRelayUrls[0]
      : undefined

    if (event.pubkey !== $logged_in_user?.hexpubkey)
      new_event.tags.push(
        parent_event_user_relay
          ? ['p', event.pubkey, parent_event_user_relay]
          : ['p', event.pubkey]
      )
    new_event.tags
      .filter((tag) => tag[0] === 'p')
      .forEach((tag) => {
        if (tag[1] !== event.pubkey && tag[1] !== $logged_in_user?.hexpubkey)
          new_event.tags.push(tag)
      })
    new_event.content = content
    submitting = true
    let relays = [
      ...($selected_repo_event.relays.length > 3
        ? $selected_repo_event.relays
        : [...base_relays].concat($selected_repo_event.relays)),
    ]
    try {
      new_event.sign()
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
      let _ = await new_event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      submitting = false
      submitted = true
      setTimeout(() => {
        submitted = false
        sentFunction()
      }, 3000)
    } catch {}
  }
</script>

{#if edit_mode}
  <Compose {sendReply} {submitting} logged_in={!!$logged_in_user} />
{/if}
{#if submitted}
  <div role="alert" class="alert mt-6">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      class="h-6 w-6 shrink-0 stroke-info"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      ></path></svg
    >
    <div>
      <h3 class="prose mb-2 text-sm font-bold">reply sent</h3>
    </div>
  </div>
{/if}
