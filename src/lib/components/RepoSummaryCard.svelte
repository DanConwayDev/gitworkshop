<script lang="ts">
  import {
    repoToNaddr,
    type Naddr,
    type PubKeyString,
    type RepoSummarisable,
  } from '$lib/dbs/types'
  import UserHeader from './users/UserHeader.svelte'
  export let repo: RepoSummarisable | undefined

  let short_name: string = 'Untitled'
  $: {
    if (repo) {
      if ('name' in repo && repo.name.length > 45)
        short_name = repo.name.slice(0, 45) + '...'
      else if ('name' in repo && repo.name.length >= 0) short_name = repo.name
      else if (repo.identifier && repo.identifier.length > 45)
        short_name = repo.identifier.slice(0, 45) + '...'
      else if (repo.identifier && repo.identifier.length >= 0)
        short_name = repo.identifier
    }
  }

  let short_descrption: string = ''
  $: {
    if (repo && 'description' in repo) {
      if (repo.name.length > 50)
        short_name = repo.description.slice(0, 45) + '...'
      else short_descrption = repo.description
    }
  }

  let author: PubKeyString | undefined = undefined
  $: {
    if (repo) {
      if ('trusted_maintainer' in repo) author = repo.trusted_maintainer
      else if ('pubkey' in repo) author = repo.pubkey
      else if ('author' in repo) author = repo.author
    }
  }

  let maintainers: PubKeyString[] = []
  let additional_maintainers: PubKeyString[] = []
  $: {
    if (repo && 'maintainers' in repo)
      additional_maintainers = repo.maintainers.filter(
        (pubkey) => pubkey !== author
      )
    maintainers = author
      ? [author, ...additional_maintainers]
      : additional_maintainers
  }

  let naddr: Naddr | undefined = undefined
  $: {
    if (repo) {
      if ('naddr' in repo) naddr = repo.naddr
      else naddr = repoToNaddr(repo)
    }
  }
</script>

<div
  class="rounded-lg bg-base-200 p-4"
  style={`min-height: ${maintainers.length * 1.325 + 2}rem;`}
>
  {#if !repo}
    <div class="skeleton mb-2 h-5 w-40"></div>
    <div class="w-100 skeleton h-4"></div>
  {:else}
    <a
      class="link-primary break-words"
      href="/r/{naddr}"
      on:click={(event) => {
        if (!naddr) {
          event.preventDefault()
        }
      }}>{short_name}</a
    >
    {#if short_descrption.length > 0}
      <p class="text-muted break-words pb-1 text-sm">
        {short_descrption}
      </p>
    {/if}

    <div class="break-words text-right text-xs text-slate-400">
      {#if author}
        <div
          class="inline"
          class:p-1={additional_maintainers.length > 0}
          class:rounded-md={additional_maintainers.length > 0}
          class:bg-base-400={additional_maintainers.length > 0}
          class:text-white={additional_maintainers.length > 0}
        >
          <UserHeader user={author} inline={true} size="xs" />
        </div>
        {#if additional_maintainers.length > 0}
          <span>with</span>

          <ul class="reposummarycard inline">
            {#each additional_maintainers as user}
              <li class="inline">
                <UserHeader {user} inline={true} size="xs" />
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style lang="postcss">
  .reposummarycard li::before {
    content: ', ';
  }
  .reposummarycard li:last-child::before {
    content: ' and ';
  }
  .reposummarycard li:first-child::before {
    content: '';
  }
</style>
