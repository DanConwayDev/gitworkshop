<script lang="ts">
  import { base_relays, ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { issue_kind, repo_kind } from '$lib/kinds'
  import { getUserRelays, logged_in_user, login } from '$lib/stores/users'
  import type { RepoEvent } from '$lib/components/repo/type'
  import { goto } from '$app/navigation'
  import { nip19 } from 'nostr-tools'

  export let repo_event: RepoEvent

  let submitting = false
  let submitted = false
  let edit_mode = false
  let title = ''
  let content = ''
  $: {
    edit_mode = !submitted
  }
  let submit_attempted = false
  
  async function sendIssue(title: string, content: string) {
    submit_attempted = true
    if (title.length < 10) return
    if (!$logged_in_user) await login()
    if (!$logged_in_user) return
    let event = new NDKEvent(ndk)
    event.kind = issue_kind

    event.tags.push(['alt', `git repository issue: ${title}`])

    if (repo_event.unique_commit) {
      event.tags.push(['r', repo_event.unique_commit])
    }
    event.tags.push([
      'a',
      `${repo_kind}:${repo_event.maintainers[0]}:${repo_event.identifier}`,
      repo_event.relays[0] || '',
      'root',
    ])
    repo_event.maintainers.forEach((m) => event.tags.push(['p', m]))
    event.content = `${title}\n\n${content}`
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
        goto(`/r/${repo_event.naddr}/issues/${nip19.noteEncode(event.id)}`)
      }, 2000)
    } catch {}
  }
</script>

{#if edit_mode}
  <div class="flex">
    <div class="flex-grow">
      <label class="form-control w-full">
        <div class="label">
          <span class="label-text text-sm">Title</span>
        </div>
        <input
          type="text"
          bind:value={title}
          class="input-neutral input input-sm input-bordered mb-3 w-full border-warning"
          class:border-warning={submit_attempted && title.length < 10}
          placeholder="title"
        />
        {#if submit_attempted && title.length < 10}
          <div class="text-warning pr-3 text-sm align-middle">title must be at least 10 characters</div>
        {/if}
      </label>
      <label class="form-control w-full">
        <div class="label">
          <span class="label-textarea text-sm">Description</span>
        </div>

        <textarea
          disabled={submitting}
          bind:value={content}
          class="textarea textarea-secondary w-full"
          placeholder="description"
          rows="10"
        ></textarea>
      </label>

      <div class="flex items-center mt-2">
        <div class="flex-auto"></div>
        {#if submit_attempted && title.length < 10}
          <div class="text-warning pr-3 text-sm align-middle">title must be at least 10 characters</div>
        {/if}
        <button
          on:click={() => sendIssue(title, content)}
          disabled={submitting || (submit_attempted && title.length < 10)}
          class="btn btn-primary btn-sm"
        >
          {#if submitting}
            Sending
          {:else if !$logged_in_user}
            Login before Sending
          {:else}
            Send
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
{#if submitted}
  <div>sent going to issue!</div>
{/if}
