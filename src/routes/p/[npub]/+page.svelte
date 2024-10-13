<script lang="ts">
  import { nip19 } from 'nostr-tools'
  import Container from '$lib/components/Container.svelte'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import AlertError from '$lib/components/AlertError.svelte'

  export let data: { npub: string }

  let error = false
  let pubkey: undefined | string
  $: {
    try {
      let decoded = nip19.decode(data.npub)
      if (decoded.type === 'npub') pubkey = decoded.data
      else if (decoded.type === 'nprofile') pubkey = decoded.data.pubkey
      else error = true
      // if (pubkey) ensureSelectedPubkeyRepoCollection(pubkey)
    } catch {
      error = true
    }
  }
</script>

<svelte:head>
  <title>GitWorkshop</title>
</svelte:head>

{#if error}
  <Container>
    <AlertError>
      <div>
        Error! profile reference in URL is not a valid npub or nprofile::
      </div>
      <div class="break-all">{data.npub}</div>
    </AlertError>
  </Container>
{:else if pubkey}
  <Container>
    <div class="mt-12">
      <UserHeader user={pubkey} link_to_profile={false} size="full" />
      <div class="divider"></div>
      <!-- <ReposSummaryList
        title="Repositories"
        repos={$selected_npub_repo_collections.collections.map(
          (c) => repoCollectionToSummary(c) || { ...summary_defaults }
        )}
        loading={false}
      /> -->
    </div>
  </Container>
{/if}
