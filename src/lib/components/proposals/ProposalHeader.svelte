<script lang="ts" context="module">
</script>

<script lang="ts">
  import dayjs from 'dayjs'
  import relativeTime from 'dayjs/plugin/relativeTime'
  import Container from '../Container.svelte'
  import Status from './Status.svelte'
  import { logged_in_user } from '$lib/stores/users'
  import StatusSelector from './StatusSelector.svelte'
  import { type IssueOrPrWithReferences } from '$lib/dbs/types'
  import UserHeader from '../users/UserHeader.svelte'
  import type { Writable } from 'svelte/store'

  dayjs.extend(relativeTime)
  export let type: 'proposal' | 'issue' = 'proposal'

  export let issue_or_pr: Writable<IssueOrPrWithReferences | undefined>
  let created_at_ago: string
  const titleToShortTitle = (title: string): string => {
    let s = ''
    if (title.length > 70) s = title.slice(0, 65) + '...'
    else if (title.length == 0) s = 'Untitled'
    else s = title
    return s
  }
  $: {
    created_at_ago = $issue_or_pr
      ? dayjs($issue_or_pr.created_at * 1000).fromNow()
      : ''
  }
</script>

<div
  class="grow border-b border-accent-content bg-base-200 pb-4 pt-2 text-xs text-neutral-content"
>
  <Container>
    {#if !$issue_or_pr}
      <div>
        <div class="skeleton h-7 w-60 pt-1"></div>
        <div class="">
          <div class="skeleton mt-3 inline-block h-8 w-20 align-middle"></div>
          <div
            class="skeleton ml-3 mt-5 inline-block h-3 w-28 align-middle"
          ></div>
          <div
            class="skeleton ml-3 mt-5 inline-block h-3 w-28 align-middle"
          ></div>
        </div>
      </div>
    {:else}
      <div class="mb-2 text-lg text-base-content">
        test
        {titleToShortTitle($issue_or_pr.title)}
      </div>
      <div class="pt-1">
        <div class="mr-3 inline align-middle">
          {#if !$logged_in_user}
            <Status {type} status={$issue_or_pr.status} edit_mode={false} />
          {:else}
            <StatusSelector
              {type}
              status={$issue_or_pr.status}
              proposal_or_issue_id={$issue_or_pr.uuid}
            />{/if}
        </div>
        <div class="mr-3 inline align-middle">
          opened {created_at_ago}
        </div>
        <div class="inline align-middle">
          <UserHeader inline={true} user={$issue_or_pr.author} />
        </div>
      </div>
    {/if}
  </Container>
</div>
