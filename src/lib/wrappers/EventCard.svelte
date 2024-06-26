<script lang="ts">
  import EventWrapper from '$lib/components/events/EventWrapper.svelte'
  import EventWrapperLite from '$lib/components/events/EventWrapperLite.svelte'
  import Status from '$lib/components/events/content/Status.svelte'
  import Patch from '$lib/components/events/content/Patch.svelte'
  import ParsedContent from '$lib/components/events/content/ParsedContent.svelte'
  import { defaults as user_defaults } from '$lib/components/users/type'
  import {
    issue_kind,
    patch_kind,
    proposal_status_kinds,
    repo_kind,
  } from '$lib/kinds'
  import { ensureUser } from '$lib/stores/users'
  import type { NDKEvent } from '@nostr-dev-kit/ndk'
  import { onDestroy } from 'svelte'
  import { writable, type Unsubscriber } from 'svelte/store'
  import {
    extractPatchMessage,
    isCoverLetter,
  } from '$lib/components/events/content/utils'
  import Repo from '$lib/components/events/content/Repo.svelte'
  import IssuePreview from '$lib/components/events/content/IssuePreview.svelte'

  export let event: NDKEvent
  export let type: 'proposal' | 'issue' = 'proposal'
  export let preview = false

  let author = writable({ ...user_defaults })
  let author_unsubsriber: Unsubscriber
  $: {
    if (event && event.pubkey.length > 0)
      author_unsubsriber = ensureUser(event.pubkey).subscribe((u) => {
        if (u.hexpubkey == event.pubkey) author.set({ ...u })
      })
  }
  onDestroy(() => {
    if (author_unsubsriber) author_unsubsriber()
  })
  const getDtag = (event: NDKEvent): undefined | string => {
    try {
      const tag = event.replaceableDTag()
      return tag
    } catch {}
  }
</script>

{#if event.kind && [6, 16].includes(event.kind)}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    reposted by
  </EventWrapperLite>
{:else if event.kind && event.kind === 5}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    deletion requested by
  </EventWrapperLite>
{:else if event.kind && event.kind === 30001}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    added to '{getDtag(event) || 'unknown'}' list by
  </EventWrapperLite>
{:else if event.kind && event.kind == repo_kind}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    <Repo {event} />
  </EventWrapperLite>
{:else if preview && event.kind && event.kind === patch_kind}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    <Patch {event} {preview} />
  </EventWrapperLite>
{:else if preview && event.kind && event.kind === issue_kind}
  <EventWrapperLite author={$author} created_at={event.created_at}>
    <IssuePreview {event} />
  </EventWrapperLite>
{:else}
  <EventWrapper {type} author={$author} created_at={event.created_at} {event}>
    {#if event.kind == patch_kind}
      {#if isCoverLetter(event.content)}
        <ParsedContent
          content={extractPatchMessage(event.content)}
          tags={event.tags}
        />
      {:else}
        <Patch {event} />
      {/if}
    {:else if event.kind && proposal_status_kinds.includes(event.kind)}
      <Status {type} status={event.kind} />
    {:else}
      <ParsedContent content={event.content} tags={event.tags} />
    {/if}
  </EventWrapper>
{/if}
