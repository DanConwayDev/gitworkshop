<script lang="ts">
  import {
    ensureProposalFull,
    selected_proposal,
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
  import {
    selectedRepoCollectionToName,
    type ARef,
    type EventIdString,
  } from '$lib/dbs/types'

  export let data: {
    repo_naddr: string
    proposal_nip19: string
  }

  let repo_naddr = data.repo_naddr
  let a_ref: ARef | undefined = undefined
  $: {
    a_ref = naddrToRepoA(repo_naddr)
  }
  $: name = selectedRepoCollectionToName($selected_repo_collection)

  let proposal_nip19 = data.proposal_nip19
  let proposal_id: EventIdString | undefined = undefined
  let invalid_proposal_ref = false
  $: {
    proposal_id = neventOrNoteToHexId(proposal_nip19)
    if (proposal_id) {
      invalid_proposal_ref = false
      ensureProposalFull(a_ref, proposal_id)
    } else {
      invalid_proposal_ref = true
    }
  }

  let repo_error = false

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

<svelte:head>
  <title>GitWorkshop: {name} - {$selected_proposal?.title}</title>
</svelte:head>

<RepoPageWrapper {repo_naddr} with_side_bar={false} selected_tab="proposals">
  {#if !$selected_proposal && waited_5_secs}
    <Container>
      <AlertError>
        {#if invalid_proposal_ref}
          <div>Error! invalid proposal reference: {proposal_id}</div>
          <div class="break-all">'{proposal_nip19}'</div>
        {:else}
          <div>
            Error! cannot find proposal {repo_error ? 'or repo ' : ''}event
          </div>
        {/if}
      </AlertError>
    </Container>
  {:else}
    <ProposalHeader issue_or_pr={selected_proposal} />
    <Container>
      <div class="mx-auto max-w-6xl lg:flex">
        <div class="md:mr-2 lg:w-2/3">
          <div class="max-w-4xl">
            {#if $selected_proposal}
              <Thread
                type="proposal"
                event={$selected_proposal.event}
                replies={$selected_proposal_replies}
              />
            {/if}
          </div>
        </div>
        <div class="prose ml-2 hidden w-1/3 lg:flex">
          <ProposalDetails type="proposal" issue_or_pr={selected_proposal} />
        </div>
      </div>
    </Container>
  {/if}
</RepoPageWrapper>
