<script lang="ts">
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import { nip19 } from 'nostr-tools'
  import AlertWarning from '../AlertWarning.svelte'
  import { icons_misc } from '../icons'
  import InstallNgit from '../InstallNgit.svelte'
  import { event_defaults } from './type'

  export let {
    event_id,
    naddr,
    identifier,
    author,
    unique_commit,
    name,
    description,
    clone,
    web,
    tags,
    maintainers,
    relays,
    referenced_by,
    most_recent_reference_timestamp,
    created_at,
    loading,
  } = event_defaults
  $: short_descrption =
    !description && description.length > 500
      ? description.slice(0, 450) + '...'
      : description
  let naddr_copied = false
  const create_nostr_url = (
    maintainers: string[],
    identifier: string,
    relays: string[]
  ) => {
    if (identifier.length > 0 && maintainers.length > 0) {
      let npub = nip19.npubEncode(maintainers[0])
      if (relays.length > 0) {
        let relay = relays[0]
          // remove trailing slash(es)
          .replace(/\/+$/, '')
        if (/^[a-zA-Z0-9.]+$/.test(relay.replace('wss://', ''))) {
          return `nostr://${npub}/${relay.replace('wss://', '')}/${identifier}`
        }
        return `nostr://${npub}/${encodeURIComponent(relay)}/${identifier}`
      }
      return `nostr://${npub}/${identifier}`
    }
    return ''
  }
  $: nostr_url = create_nostr_url(maintainers, identifier, relays)
  let nostr_url_copied = false
  let git_url_copied: false | string = false
  let maintainer_copied: false | string = false
  $: event_not_found = !loading && created_at == 0
</script>

<div class="prose w-full max-w-md">
  {#if event_not_found}
    <h4 class="mt-0 pt-1">identifier</h4>
    <p class="my-2 break-words text-sm">{identifier}</p>
  {:else}
    {#if name == identifier}
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="skeleton my-2 h-4"></div>
        <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
      {:else if !name || name.length == 0}
        <h4 class="mt-0 pt-1">name / identifier</h4>
        <div>none</div>
      {:else}
        <h4 class="mt-0 pt-1">name / identifier</h4>
        <p class="my-2 break-words text-sm">{name}</p>
      {/if}
    {:else}
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="skeleton my-2 h-4"></div>
        <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
      {:else if !name || name.length == 0}
        <h4>name</h4>
        <div>none</div>
      {:else}
        <h4>name</h4>
        <p class="my-2 break-words text-sm">{name}</p>
      {/if}
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="skeleton my-2 h-4"></div>
        <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
      {:else if !identifier || identifier.length == 0}
        <h4>identifier</h4>
        <div>none</div>
      {:else}
        <h4>identifier</h4>
        <p class="my-2 break-words text-sm">{identifier}</p>
      {/if}
    {/if}
    {#if !loading}
      <div class="dropdown dropdown-end mt-3">
        <div tabIndex={0} class="btn btn-success btn-sm text-base-400">
          clone
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            class="h-5 w-5 flex-none fill-success-content"
            ><path
              fill="currentColor"
              d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
            /></svg
          >
        </div>
        <ul
          tabIndex={0}
          class="w-md menu dropdown-content z-[1] ml-0 rounded-box bg-base-300 p-2 shadow"
        >
          <li class="prose">
            <div>
              <div>
                <h4 class="mt-0">1. install ngit and git-remote-nostr</h4>
                <InstallNgit size="sm" />
              </div>
            </div>
          </li>
          <li class="m-0 p-0">
            <!-- eslint-disable-next-line svelte/valid-compile -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
              on:click={async () => {
                try {
                  await navigator.clipboard.writeText(nostr_url)
                  nostr_url_copied = true
                  setTimeout(() => {
                    nostr_url_copied = false
                  }, 2000)
                } catch {}
              }}
              class="group cursor-pointer rounded-md"
            >
              <div>
                <h4 class="mt-0 pt-0">
                  2. copy git clone url
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50 group-hover:opacity-100"
                    class:fill-base-content={!nostr_url_copied}
                    class:fill-success={nostr_url_copied}
                  >
                    {#each icons_misc.copy as d}
                      <path {d} />
                    {/each}
                  </svg>

                  {#if nostr_url_copied}<span
                      class="text-sm text-success opacity-50"
                    >
                      (copied to clipboard)</span
                    >{/if}
                </h4>
                <p class="my-2 break-words border p-2 text-xs">{nostr_url}</p>
              </div>
            </div>
          </li>
        </ul>
      </div>
    {/if}
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="skeleton my-2 h-4"></div>
      <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
    {:else if !short_descrption || description.length == 0}
      <h4>description</h4>
      <div>none</div>
    {:else}
      <h4>description</h4>
      <p class="my-2 break-words text-sm">{short_descrption}</p>
    {/if}
    <div>
      {#if loading}
        <div class="badge skeleton w-20"></div>
        <div class="badge skeleton w-20"></div>
      {:else}
        {#each tags as tag}
          <div class="badge badge-secondary mr-2">{tag}</div>
        {/each}
      {/if}
    </div>
    <div>
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="badge skeleton my-2 block w-60"></div>
      {:else if clone.length == 0}
        <div />
      {:else}
        <h4>
          git servers {#if git_url_copied}<span
              class="text-sm text-success opacity-50"
            >
              (copied to clipboard)</span
            >{/if}
        </h4>
        {#each clone as git_url}
          <!-- eslint-disable-next-line svelte/valid-compile -->
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            on:click={async () => {
              try {
                await navigator.clipboard.writeText(git_url)
                git_url_copied = git_url
                setTimeout(() => {
                  git_url_copied = false
                }, 2000)
              } catch {}
            }}
            class="group my-2 mt-3 cursor-pointer break-words text-xs"
            class:text-success={git_url_copied === git_url}
            class:opacity-50={git_url_copied === git_url}
          >
            {git_url}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
              class:group-hover:opacity-100={git_url_copied !== git_url}
              class:fill-base-content={git_url_copied !== git_url}
              class:fill-success={git_url_copied === git_url}
              class:opacity-100={git_url_copied === git_url}
            >
              {#each icons_misc.copy as d}
                <path {d} />
              {/each}
            </svg>
          </div>
        {/each}
      {/if}
    </div>
    <div>
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="badge skeleton my-2 block w-60"></div>
        <div class="badge skeleton my-2 block w-40"></div>
      {:else if web.length == 0}
        <h4>websites</h4>
        <div>none</div>
      {:else}
        <h4>websites</h4>
        {#each web as site}
          <a
            href={site}
            target="_blank"
            class="link link-primary my-2 break-words text-sm"
          >
            {site}
          </a>
        {/each}
      {/if}
    </div>
  {/if}

  <div>
    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="badge skeleton my-2 block w-60"></div>
      <div class="badge skeleton my-2 block w-40"></div>
    {:else if maintainers.length == 0}
      <div />
    {:else}
      <h4>
        {#if event_not_found}author{:else}maintainers{/if}
        {#if maintainer_copied}<span class="text-sm text-success opacity-50">
            (copied to clipboard)</span
          >{/if}
      </h4>
      {#each maintainers as maintainer}
        <div class="my-2 mt-3 break-words text-xs">
          <UserHeader user={maintainer} />
        </div>
      {/each}
    {/if}
  </div>

  {#if !event_not_found}
    <div>
      {#if loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="badge skeleton my-2 block w-60"></div>
        <div class="badge skeleton my-2 block w-40"></div>
      {:else if relays.length == 0}
        <h4>relays</h4>
        <div>none</div>
      {:else}
        <h4>relays</h4>
        {#each relays as relay}
          <div class="badge badge-secondary badge-sm my-2 block">{relay}</div>
        {/each}
      {/if}
    </div>

    {#if loading}
      <div class="skeleton my-3 h-5 w-20"></div>
      <div class="skeleton my-2 h-4"></div>
      <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
    {:else if !unique_commit || unique_commit.length == 0}
      <h4>earliest unique commit</h4>
      <p class="my-2 break-words text-xs">not specified</p>
    {:else}
      <h4>earliest unique commit</h4>
      <p class="my-2 break-words text-xs">{unique_commit}</p>
    {/if}
  {/if}

  {#if loading}
    <div class="skeleton my-3 h-5 w-20"></div>
    <div class="skeleton my-2 h-4"></div>
    <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
  {:else if naddr && naddr.length > 0}
    <!-- eslint-disable-next-line svelte/valid-compile -->
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      on:click={async () => {
        try {
          await navigator.clipboard.writeText(naddr)
          naddr_copied = true
          setTimeout(() => {
            naddr_copied = false
          }, 2000)
        } catch {}
      }}
      class="group -ml-3 mt-3 cursor-pointer rounded-md p-3 hover:bg-base-300"
    >
      <h4 class="mt-0 pt-0">
        naddr
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          class="ml-1 inline h-4 w-4 flex-none fill-base-content opacity-50 group-hover:opacity-100"
          class:fill-base-content={!naddr_copied}
          class:fill-success={naddr_copied}
        >
          {#each icons_misc.copy as d}
            <path {d} />
          {/each}
        </svg>

        {#if naddr_copied}<span class="text-sm text-success opacity-50">
            (copied to clipboard)</span
          >{/if}
      </h4>
      <p class="my-2 break-words text-xs">{naddr}</p>
    </div>
  {/if}
  {#if event_not_found}
    <div class="text-xs">
      <AlertWarning>
        <div class="pb-1 font-semibold">missing repository details</div>
        <div>cannot find referenced repository event</div>
      </AlertWarning>
    </div>
  {/if}
</div>
