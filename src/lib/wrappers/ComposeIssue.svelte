<script lang="ts">
  import { base_relays, ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { issue_kind, repo_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user } from '$lib/stores/users'
  import Compose from '$lib/components/events/Compose.svelte'
  import type { RepoEvent } from '$lib/components/repo/type'
  import { goto } from '$app/navigation'

  export let repo_event: RepoEvent

  let submitting = false
  let submitted = false
  let edit_mode = false
  $: {
    edit_mode = !submitted
  }

  async function sendIssue(content: string) {
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = issue_kind

    if (repo_event.unique_commit) {
      event.tags.push(['r', repo_event.unique_commit])
    }
    event.tags.push([
      'a',
      `${repo_kind}:${repo_event.maintainers[0].hexpubkey}:${repo_event.identifier}`,
      repo_event.relays[0] || '',
      'root',
    ])
    repo_event.maintainers.forEach((m) => event.tags.push(['p', m.hexpubkey]))
    // TODO nip-10 reply chain p tags
    event.content = content
    submitting = true
    let relays = [
      ...(repo_event.relays.length > 3
        ? repo_event.relays
        : [...base_relays].concat(repo_event.relays)),
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
      ]
    } catch {
      alert('failed to get user relays')
    }
    try {
      let _ = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      submitting = false
      submitted = true
      setTimeout(() => {
        goto(`/repo/${repo_event.identifier}/issues/${event.id}`)
      }, 2000)
    } catch {}
  }
</script>

{#if edit_mode}
  <Compose
    sendReply={sendIssue}
    {submitting}
    logged_in={!!$logged_in_user}
    placeholder="title on first line..."
  />
{/if}
{#if submitted}
  <div>sent going to issue!</div>
{/if}
