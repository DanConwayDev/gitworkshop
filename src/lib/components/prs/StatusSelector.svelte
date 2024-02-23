<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { selected_pr_full, selected_pr_replies } from '$lib/stores/PR'
  import {
    proposal_status_applied,
    proposal_status_closed,
    proposal_status_draft,
    proposal_status_open,
    statusKindtoText,
  } from '$lib/kinds'
  import { getUserRelays, logged_in_user } from '$lib/stores/users'
  import { selected_repo } from '$lib/stores/repo'
  import Status from '$lib/components/prs/Status.svelte'

  export let status: number | undefined = undefined
  export let repo_id: string = ''
  export let pr_id: string = ''

  let loading = false

  let edit_mode = false
  $: {
    edit_mode =
      $logged_in_user !== undefined && repo_id === $selected_repo.repo_id
  }

  async function changeStatus(new_status_kind: number) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = new_status_kind
    // tag pr event
    event.tags.push(['e', pr_id, 'root'])
    // tag pr revision event
    $selected_pr_replies
      .filter((reply) =>
        reply.tags.some((t) => t.length > 1 && t[1] === 'revision-root')
      )
      .forEach((revision) => {
        event.tags.push(['e', revision.id, 'mention'])
      })
    event.tags.push(['r', `${repo_id}`])
    loading = true
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
        // TODO: pr event pubkey relays
      ]
    } catch {
      alert('failed to get user relays')
    }
    try {
      let _ = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      selected_pr_full.update((pr_full) => {
        if (pr_full.summary.id !== pr_id) return pr_full
        return {
          ...pr_full,
          summary: {
            ...pr_full.summary,
            status: new_status_kind,
            status_date: event.created_at || 0,
          },
        }
      })
      loading = false
    } catch {}
  }
</script>

{#if loading || !status}
  <Status />
{:else}
  <div class="dropdown">
    <Status {edit_mode} {status} />
    {#if edit_mode}
      <ul
        tabIndex={0}
        class="menu dropdown-content z-[1] ml-0 w-52 rounded-box bg-base-300 p-2 shadow"
      >
        {#if status !== proposal_status_draft}
          <li class="pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_draft)
              }}
              class="btn btn-neutral btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_draft)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_open}
          <li class="pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_open)
              }}
              class="btn btn-success btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_open)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_applied}
          <li class="pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_applied)
              }}
              class="btn btn-primary btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_applied)}</button
            >
          </li>
        {/if}
        {#if status !== proposal_status_closed}
          <li class="pl-0">
            <button
              on:click={() => {
                changeStatus(proposal_status_closed)
              }}
              class="btn btn-neutral btn-sm mx-2 align-middle"
              >{statusKindtoText(proposal_status_closed)}</button
            >
          </li>
        {/if}
      </ul>
    {/if}
  </div>
{/if}
