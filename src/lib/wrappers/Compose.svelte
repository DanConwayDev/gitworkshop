<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { reply_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user } from '$lib/stores/users'
  import { selected_repo } from '$lib/stores/repo'
  import Compose from '$lib/components/events/Compose.svelte'
  import { selected_pr_full } from '$lib/stores/PR'

  export let reply_to_event_id = ''

  let repo_id: string
  let pr_id: string

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    repo_id = $selected_repo.repo_id
    pr_id = $selected_pr_full.summary.id

    edit_mode =
      $logged_in_user !== undefined &&
      repo_id.length > 0 &&
      pr_id.length > 0 &&
      !submitted
  }

  async function sendReply(content: string) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = reply_kind
    event.tags.push(['e', pr_id, 'root'])
    if (reply_to_event_id.length > 0) {
      event.tags.push(['e', pr_id, 'reply'])
    }
    event.tags.push(['r', `r-${repo_id}`])
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
        // TODO: pr event pubkey relays
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
  <Compose {sendReply} {submitting} />
{/if}
{#if submitted}
  <div>sent!</div>
{/if}
