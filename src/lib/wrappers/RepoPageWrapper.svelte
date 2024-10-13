<script lang="ts">
  import RepoDetails from '$lib/wrappers/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
  } from '$lib/stores/repo'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Container from '$lib/components/Container.svelte'
  import type { RepoPage } from '$lib/components/repo/type'
  import { naddrToPointer, naddrToRepoA } from '$lib/components/repo/utils'
  import AlertError from '$lib/components/AlertError.svelte'

  export let repo_naddr = ''
  export let selected_tab: RepoPage = 'about'
  export let with_side_bar = true
  export let show_details_on_mobile = false

  $: a = naddrToRepoA(repo_naddr)

  $: {
    if (a) ensureSelectedRepoCollection(a, naddrToPointer(repo_naddr)?.relays)
  }
</script>

<RepoHeader repo_collection={$selected_repo_collection} {selected_tab} />
{#if !a}
  <Container>
    <AlertError>
      <div>Error! invalid naddr in url:</div>
      <div class="break-all">{repo_naddr}</div>
    </AlertError>
  </Container>
  <Container>
    <slot />
  </Container>
{:else if with_side_bar}
  <Container>
    <div class="mt-2 md:flex">
      <div class="md:mr-2 md:w-2/3">
        <slot />
      </div>
      <div
        class:hidden={!show_details_on_mobile}
        class=" rounded-lg border border-base-400 md:flex md:w-1/3 md:border-none"
      >
        <div class="border-b border-base-400 bg-base-300 px-6 py-3 md:hidden">
          <h4 class="">Repository Details</h4>
        </div>
        <div class="prose my-3 w-full px-6 md:ml-2 md:px-0">
          <RepoDetails {a} />
        </div>
      </div>
    </div>
  </Container>
{:else}
  <slot />
{/if}
