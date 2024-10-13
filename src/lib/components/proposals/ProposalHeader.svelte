<script lang="ts" context="module">
</script>

<script lang="ts">
  import dayjs from 'dayjs'
  import relativeTime from 'dayjs/plugin/relativeTime'
  import { summary_defaults } from './type'
  import { getName } from '../users/type'
  import Container from '../Container.svelte'
  import Status from './Status.svelte'
  import { logged_in_user } from '$lib/stores/users'
  import StatusSelector from './StatusSelector.svelte'
  import relays_manager from '$lib/stores/RelaysManager'
  import { isPubKeyMetadataLoading } from '$lib/dbs/types'

  dayjs.extend(relativeTime)
  export let type: 'proposal' | 'issue' = 'proposal'
  export let {
    title,
    descritpion,
    repo_a,
    id,
    comments,
    status,
    status_date,
    author,
    created_at,
    loading,
  } = summary_defaults
  let short_title: string
  let created_at_ago: string
  let author_name = ''

  $: author_object = relays_manager.fetchPubkeyInfoWithObserable(author || '')

  $: {
    author_name = getName($author_object)
  }
  $: {
    if (title.length > 70) short_title = title.slice(0, 65) + '...'
    else if (title.length == 0) short_title = 'Untitled'
    else short_title = title
    created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : ''
  }
</script>

<div
  class="grow border-b border-accent-content bg-base-200 pb-4 pt-2 text-xs text-neutral-content"
>
  <Container>
    {#if loading}
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
        {short_title}
      </div>
      <div class="pt-1">
        <div class="mr-3 inline align-middle">
          {#if !$logged_in_user}
            <Status {type} {status} edit_mode={false} />
          {:else}
            <StatusSelector {type} {status} proposal_or_issue_id={id} />{/if}
        </div>
        <div class="mr-3 inline align-middle">
          opened {created_at_ago}
        </div>
        <div class="inline align-middle">
          {#if isPubKeyMetadataLoading($author_object)}
            <div class="skeleton inline-block h-3 w-20 pb-2"></div>
          {:else}
            {author_name}
          {/if}
        </div>
      </div>
    {/if}
  </Container>
</div>
