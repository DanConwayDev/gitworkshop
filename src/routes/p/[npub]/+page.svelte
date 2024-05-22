<script lang="ts">
  import { nip19 } from 'nostr-tools'
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import {
    ensureSelectedPubkeyRepoCollection,
    selected_npub_repo_collections,
  } from '$lib/stores/ReposPubkey'
  import { repoCollectionToSummary } from '$lib/stores/repos'
  import { summary_defaults } from '$lib/components/repo/type'

  export let data: { npub: string }

  let error = false
  let pubkey: undefined | string
  $: {
    try {
      let decoded = nip19.decode(data.npub)
      if (decoded.type === 'npub') pubkey = decoded.data
      else if (decoded.type === 'nprofile') pubkey = decoded.data.pubkey
      else error = true
      if (pubkey) ensureSelectedPubkeyRepoCollection(pubkey)
    } catch {
      error = true
    }
  }
</script>

{#if error}
  <Container>
    <div
      role="alert"
      class="wrap alert alert-error m-auto mt-6 w-full max-w-lg"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        /></svg
      >
      <span
        >Error! profile reference in URL is not a valid npub or nprofile: {data.npub}</span
      >
    </div>
  </Container>
{:else if pubkey}
  <Container>
    <div class="mt-12">
      <UserHeader user={pubkey} link_to_profile={false} size="full" />
      <div class="divider"></div>
      <ReposSummaryList
        title="Repositories"
        repos={$selected_npub_repo_collections.collections.map(
          (c) => repoCollectionToSummary(c) || { ...summary_defaults }
        )}
        loading={false}
      />
    </div>
  </Container>
{/if}
