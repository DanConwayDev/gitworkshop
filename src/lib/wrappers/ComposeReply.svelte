<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { type Event } from 'nostr-tools'
  import { reply_kind } from '$lib/kinds'
  import { logged_in_user } from '$lib/stores/users'
  import { selected_repo_collection } from '$lib/stores/repo'
  import Compose from '$lib/components/events/Compose.svelte'
  import { selected_proposal } from '$lib/stores/Proposal'
  import { selected_issue } from '$lib/stores/Issue'
  import {
    selectedRepoCollectionToRelays,
    type IssueOrPrWithReferences,
  } from '$lib/dbs/types'
  import { tagRepoAnns } from '$lib/utils'
  import relays_manager from '$lib/stores/RelaysManager'

  export let type: 'proposal' | 'issue' = 'proposal'
  export let event: Event
  export let sentFunction = () => {}
  let repo_identifier: string
  let selected_proposal_or_issue: IssueOrPrWithReferences

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    repo_identifier =
      ($selected_repo_collection && $selected_repo_collection.identifier) || ''
    selected_proposal_or_issue =
      type === 'proposal' ? $selected_proposal : $selected_issue

    edit_mode =
      repo_identifier.length > 0 &&
      selected_proposal_or_issue.summary.id.length > 0 &&
      !submitted
  }
  /** to get the proposal revision id rather than the root proposal */
  const getRootId = (event: Event): string => {
    // exclude 'a' references to repo events
    let root_tag = event.tags.find(
      (t) => t[0] === 'e' && t.length === 4 && t[3] === 'root'
    )
    if (root_tag) return root_tag[1]
    if (event.tags.some((t) => t[0] === 't' && t[1] === 'root')) return event.id
    return selected_proposal_or_issue.summary.id
  }

  async function sendReply(content: string) {
    if (!$logged_in_user) return
    let new_event = new NDKEvent(ndk)
    new_event.kind = reply_kind
    if (reply_kind !== 1) event.tags.push(['alt', `git reply`])
    let relay_hint =
      !$selected_repo_collection || !$selected_repo_collection.relays
        ? ''
        : $selected_repo_collection.relays[0] || ''
    new_event.tags.push(['e', getRootId(event), relay_hint, 'root'])
    if (event.id.length > 0) {
      new_event.tags.push(['e', event.id, relay_hint, 'reply'])
    }
    if (
      $selected_repo_collection &&
      'unique_commit' in $selected_repo_collection &&
      !!$selected_repo_collection.unique_commit
    ) {
      new_event.tags.push(['r', $selected_repo_collection.unique_commit])
    }

    let parent_event_user_info = await relays_manager.awaitPubKeyInfo(
      event.pubkey
    )

    if (event.pubkey !== $logged_in_user?.pubkey)
      new_event.tags.push(
        parent_event_user_info.relays.write[0]
          ? ['p', event.pubkey, parent_event_user_info.relays.write[0]]
          : ['p', event.pubkey]
      )
    event.tags
      .filter((tag) => tag[0] === 'p')
      .forEach((tag) => {
        if (
          // not duplicate
          !new_event.tags.some((t) => t[1] === tag[1]) &&
          // not current user (dont tag self)
          tag[1] !== $logged_in_user?.pubkey
        )
          new_event.tags.push(tag)
      })
    tagRepoAnns(new_event, $selected_repo_collection)
    new_event.content = content
    submitting = true
    let relays = selectedRepoCollectionToRelays($selected_repo_collection)
    try {
      new_event.sign()
    } catch {
      alert('failed to sign event')
    }
    try {
      relays = [...relays, ...$logged_in_user.relays.write]
    } catch {}
    try {
      let root_event_user_relays = await relays_manager.awaitPubKeyInfo(
        event.pubkey
      )
      relays = [...relays, ...root_event_user_relays.relays.write]
    } catch {}
    // TODO root event user relays
    try {
      let _ = await new_event.publish(
        NDKRelaySet.fromRelayUrls([...new Set(relays)], ndk)
      )
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
