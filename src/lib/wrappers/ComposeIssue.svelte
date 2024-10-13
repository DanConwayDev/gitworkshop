<script lang="ts">
  import { ndk } from '$lib/stores/ndk'
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
  import { issue_kind } from '$lib/kinds'
  import { logged_in_user, login } from '$lib/stores/users'
  import { goto } from '$app/navigation'
  import { nip19 } from 'nostr-tools'
  import {
    selectedRepoCollectionToRelays,
    type SelectedRepoCollection,
  } from '$lib/dbs/types'
  import { tagRepoAnns } from '$lib/utils'

  export let repo_collection: Exclude<SelectedRepoCollection, undefined>

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
    event.tags.push(['subject', title])
    event.tags.push(['alt', `git repository issue: ${title}`])
    tagRepoAnns(event, repo_collection, true, true)
    event.content = `${content}`
    submitting = true
    let relays = selectedRepoCollectionToRelays(repo_collection)
    try {
      event.sign()
    } catch {
      alert('failed to sign event')
    }
    try {
      relays = [...relays, ...$logged_in_user.relays.write]
    } catch {
      alert('failed to get user relays')
    }
    try {
      let _ = await event.publish(NDKRelaySet.fromRelayUrls(relays, ndk))
      submitting = false
      submitted = true
      setTimeout(() => {
        goto(`/r/${repo_collection.naddr}/issues/${nip19.noteEncode(event.id)}`)
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
          <div class="pr-3 align-middle text-sm text-warning">
            title must be at least 10 characters
          </div>
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

      <div class="mt-2 flex items-center">
        <div class="flex-auto"></div>
        {#if submit_attempted && title.length < 10}
          <div class="pr-3 align-middle text-sm text-warning">
            title must be at least 10 characters
          </div>
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
