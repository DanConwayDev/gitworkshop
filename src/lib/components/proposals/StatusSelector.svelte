<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { selected_proposal_replies } from '$lib/stores/Proposal'
  import {
    proposal_status_applied,
    proposal_status_closed,
    proposal_status_draft,
    proposal_status_open,
    statusKindtoText,
  } from '$lib/kinds'
  import { logged_in_user } from '$lib/stores/users'
  import { selected_repo_collection } from '$lib/stores/repo'
  import Status from '$lib/components/proposals/Status.svelte'
  import { selectedRepoCollectionToRelays } from '$lib/dbs/types'

  export let status: number | undefined = undefined
  export let type: 'proposal' | 'issue' = 'proposal'
  export let proposal_or_issue_id: string = ''

  let loading = false

  let edit_mode = false
  $: {
    edit_mode = $logged_in_user !== undefined
  }

  async function changeStatus(new_status_kind: number) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = new_status_kind
    // tag proposal event
    event.tags.push(['e', proposal_or_issue_id, 'root'])
    // tag proposal revision event
    $selected_proposal_replies
      .filter((reply) =>
        reply.tags.some((t) => t.length > 1 && t[1] === 'revision-root')
      )
      .forEach((revision) => {
        event.tags.push(['e', revision.id, 'mention'])
      })
    if (
      $selected_repo_collection &&
      'unique_commit' in $selected_repo_collection &&
      !!$selected_repo_collection.unique_commit
    ) {
      event.tags.push(['r', $selected_repo_collection.unique_commit])
    }

    loading = true
    let relays = selectedRepoCollectionToRelays($selected_repo_collection)
    try {
      event.sign()
    } catch {
      alert('failed to sign event')
    }
    try {
      relays = [
        ...relays,
        ...$logged_in_user.relays.write,
        // TODO: proposal event pubkey relays
      ]
    } catch {}
    try {
      let _ = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      loading = false
    } catch {}
  }
</script>

{#if loading || !status}
  <Status {type} />
{:else}
  <div class="dropdown">
    <Status {type} {edit_mode} {status} />
    {#if edit_mode}
      <ul
        tabIndex={0}
        class="menu dropdown-content z-[1] ml-0 w-52 rounded-box bg-base-300 p-2 shadow"
      >
        {#if status !== proposal_status_draft && type !== 'issue'}
          <li class="my-2 pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_draft)
              }}
              class="btn btn-neutral btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_draft, type)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_open}
          <li class="my-2 pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_open)
              }}
              class="btn btn-success btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_open, type)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_applied}
          <li class="my-2 pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_applied)
              }}
              class="btn btn-primary btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_applied, type)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_closed}
          <li class="my-2 pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_closed)
              }}
              class="btn btn-neutral btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_closed, type)}</button
            >
          </li>
        {/if}
      </ul>
    {/if}
  </div>
{/if}
