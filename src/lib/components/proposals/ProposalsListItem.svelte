<script lang="ts" context="module">
</script>

<script lang="ts">
  import dayjs from 'dayjs'
  import relativeTime from 'dayjs/plugin/relativeTime'
  import { proposal_icon_path } from './icons'
  import UserHeader from '../users/UserHeader.svelte'
  import {
    proposal_status_applied,
    proposal_status_closed,
    proposal_status_draft,
    proposal_status_open,
  } from '$lib/kinds'
  import { issue_icon_path } from '../issues/icons'
  import { aRefToAddressPointer, aToNaddr, naddrToPointer } from '../repo/utils'
  import { nip19 } from 'nostr-tools'
  import type { IssueOrPrWithReferences } from '$lib/dbs/types'

  dayjs.extend(relativeTime)
  export let type: 'issue' | 'proposal' = 'proposal'

  export let issue_or_pr: IssueOrPrWithReferences | undefined = undefined
  export let show_repo: boolean = false
  export let repo_naddr_override: string | undefined = undefined
  let short_title: string
  let created_at_ago: string
  $: {
    if (!issue_or_pr) short_title = ''
    else if (issue_or_pr.title.length > 70)
      short_title = issue_or_pr.title.slice(0, 65) + '...'
    else if (issue_or_pr.title.length == 0) short_title = 'Untitled'
    else short_title = issue_or_pr.title
    created_at_ago = issue_or_pr
      ? dayjs(issue_or_pr.created_at * 1000).fromNow()
      : ''
  }
  let repo_naddr = ''
  let repo_identifier = ''
  $: {
    if (issue_or_pr) {
      repo_naddr =
        repo_naddr_override || aToNaddr(issue_or_pr.parent_ids[0]) || ''
      if (repo_naddr_override) {
        repo_identifier =
          naddrToPointer(repo_naddr)?.identifier ||
          aRefToAddressPointer(issue_or_pr.parent_ids[0])?.identifier ||
          ''
      }
    }
  }
  let comments = 0 // TODO count issue_or_pr.thread
</script>

<li
  class="flex p-2 pt-4 {issue_or_pr ? 'cursor-pointer hover:bg-base-200' : ''}"
>
  <!-- <figure class="p-4 pl-0 text-color-primary"> -->
  <!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
  {#if !issue_or_pr}
    <div class="skeleton h-5 w-5 flex-none pt-1"></div>
  {:else if issue_or_pr.status === proposal_status_open}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      class="h-5 w-5 flex-none fill-success pt-1"
    >
      {#if type === 'proposal'}
        <path d={proposal_icon_path.open_patch} />
      {:else if type === 'issue'}
        {#each issue_icon_path.open as p}
          <path d={p} />
        {/each}
      {/if}
    </svg>
  {:else if issue_or_pr.status === proposal_status_closed}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      class="h-5 w-5 flex-none fill-neutral-content pt-1"
    >
      {#if type === 'proposal'}
        <path d={proposal_icon_path.close} />
      {:else if type === 'issue'}
        {#each issue_icon_path.closed as p}
          <path d={p} />
        {/each}
      {/if}
    </svg>
  {:else if issue_or_pr.status === proposal_status_draft}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      class="h-5 w-5 flex-none fill-neutral-content pt-1"
      ><path d={proposal_icon_path.draft} /></svg
    >
  {:else if issue_or_pr.status === proposal_status_applied}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      class="h-5 w-5 flex-none fill-primary pt-1"
    >
      {#if type === 'proposal'}
        <path d={proposal_icon_path.applied} />
      {:else if type === 'issue'}
        {#each issue_icon_path.resolved as p}
          <path d={p} />
        {/each}
      {/if}
    </svg>
  {/if}
  <a
    href="/r/{repo_naddr}/{type}s/{issue_or_pr
      ? nip19.noteEncode(issue_or_pr.uuid)
      : ''}"
    class="ml-3 grow overflow-hidden text-xs text-neutral-content"
    class:pointer-events-none={!issue_or_pr}
  >
    {#if !issue_or_pr}
      <div class="skeleton h-5 w-60 flex-none pt-1"></div>
      <div class="skeleton mb-1 mt-3 h-3 w-40 flex-none"></div>
    {:else}
      <div class="text-sm text-base-content">
        {short_title}
      </div>
      <!-- <div class="text-xs text-neutral-content">
                {description}
            </div> -->
      <ul class="pt-2">
        {#if comments > 0}
          <li class="mr-3 inline align-middle">
            <!-- http://icon-sets.iconify.design/octicon/comment-16/ -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="inline-block h-3 w-3 flex-none fill-base-content pt-0"
              viewBox="0 0 16 16"
              ><path
                d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"
              /></svg
            >
            {comments}
          </li>
        {/if}
        <li class="mr-3 inline">
          opened {created_at_ago}
        </li>
        <li class="inline">
          <UserHeader user={issue_or_pr.author} inline={true} size="xs" />
        </li>
        {#if show_repo && repo_identifier.length > 0}
          <li class="ml-3 inline">
            <a class="link-primary z-10" href="/r/{repo_naddr}">
              {repo_identifier}
            </a>
          </li>
        {/if}
      </ul>
    {/if}
  </a>
  <!-- <div class="flex-none text-xs pt-0 hidden md:block">
        <div class="align-middle">
            {#if loading}
                <div class="skeleton w-10 h-10"></div>
            {:else}
                <Avatar />
            {/if}
        </div>
    </div> -->
</li>
