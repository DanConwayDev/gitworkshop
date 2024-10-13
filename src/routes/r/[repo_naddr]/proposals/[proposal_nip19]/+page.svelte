<script lang="ts">
  import {
    ensureProposalFull,
    selected_proposal_full,
    selected_proposal_replies,
  } from '$lib/stores/Proposal'
  import Thread from '$lib/wrappers/Thread.svelte'
  import Container from '$lib/components/Container.svelte'
  import ProposalHeader from '$lib/components/proposals/ProposalHeader.svelte'
  import ProposalDetails from '$lib/components/proposals/ProposalDetails.svelte'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'
  import { naddrToRepoA, neventOrNoteToHexId } from '$lib/components/repo/utils'
  import AlertError from '$lib/components/AlertError.svelte'
  import { selected_repo_collection } from '$lib/stores/repo'
  import { selectedRepoCollectionToName } from '$lib/dbs/types'

  export let data: {
    repo_naddr: string
    proposal_nip19: string
  }

  let repo_naddr = data.repo_naddr
  let a = ''
  $: {
    const a_result = naddrToRepoA(repo_naddr)
    if (a_result) a = a_result
  }
  $: name = selectedRepoCollectionToName($selected_repo_collection)

  let proposal_nip19 = data.proposal_nip19
  let proposal_id = ''
  let invalid_proposal_ref = false
  $: {
    const proposal_nip19_result = neventOrNoteToHexId(proposal_nip19)

    if (proposal_nip19_result) {
      proposal_id = proposal_nip19_result
      invalid_proposal_ref = false
      ensureProposalFull(a, proposal_id)
    } else {
      invalid_proposal_ref = true
    }
  }

  let repo_error = false
  let proposal_error = false
  $: {
    proposal_error =
      !$selected_proposal_full.summary.loading &&
      $selected_proposal_full.summary.created_at === 0
  }

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

<svelte:head>
  <title>GitWorkshop: {name} - {$selected_proposal_full.summary.title}</title>
</svelte:head>

<RepoPageWrapper {repo_naddr} with_side_bar={false} selected_tab="proposals">
  {#if invalid_proposal_ref || (waited_5_secs && proposal_error)}
    <Container>
      <AlertError>
        {#if invalid_proposal_ref}
          <div>Error! invalid Issue reference: {proposal_id}</div>
          <div class="break-all">'{proposal_nip19}'</div>
        {:else}
          <div>
            Error! cannot find Issue {repo_error ? 'or repo ' : ''}event
          </div>
        {/if}
      </AlertError>
    </Container>
  {:else}
    <ProposalHeader {...$selected_proposal_full.summary} />
    <Container>
      <div class="mx-auto max-w-6xl lg:flex">
        <div class="md:mr-2 lg:w-2/3">
          <div class="max-w-4xl">
            {#if $selected_proposal_full.proposal_event}
              <Thread
                type="proposal"
                event={$selected_proposal_full.proposal_event}
                replies={$selected_proposal_replies}
              />
            {/if}
          </div>
        </div>
        <div class="prose ml-2 hidden w-1/3 lg:flex">
          <ProposalDetails
            type="proposal"
            summary={$selected_proposal_full.summary}
            labels={$selected_proposal_full.labels}
            loading={$selected_proposal_full.loading}
          />
        </div>
      </div>
    </Container>
  {/if}
</RepoPageWrapper>
