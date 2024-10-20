<script lang="ts">
  import {
    ensureIssueFull,
    selected_issue,
    selected_issue_replies,
  } from '$lib/stores/Issue'
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
    issue_nip19: string
  }

  let repo_naddr = data.repo_naddr
  let a_ref: ARef | undefined = undefined
  $: {
    a_ref = naddrToRepoA(repo_naddr)
  }
  $: name = selectedRepoCollectionToName($selected_repo_collection)

  let issue_nip19 = data.issue_nip19
  let issue_id: EventIdString | undefined = undefined
  let invalid_issue_ref = false
  $: {
    issue_id = neventOrNoteToHexId(issue_nip19)
    if (issue_id) {
      invalid_issue_ref = false
      ensureIssueFull(a_ref, issue_id)
    } else {
      invalid_issue_ref = true
    }
  }

  let repo_error = false

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

<svelte:head>
  <title>GitWorkshop: {name} - {$selected_issue?.title}</title>
</svelte:head>

<RepoPageWrapper {repo_naddr} with_side_bar={false} selected_tab="issues">
  {#if !$selected_issue && waited_5_secs}
    <Container>
      <AlertError>
        {#if invalid_issue_ref}
          <div>Error! invalid Issue reference: {issue_id}</div>
          <div class="break-all">'{issue_nip19}'</div>
        {:else}
          <div>
            Error! cannot find Issue {repo_error ? 'or repo ' : ''}event
          </div>
        {/if}
      </AlertError>
    </Container>
  {:else}
    <ProposalHeader issue_or_pr={selected_issue} />
    <Container>
      <div class="mx-auto max-w-6xl lg:flex">
        <div class="md:mr-2 lg:w-2/3">
          <div class="max-w-4xl">
            {#if $selected_issue}
              <Thread
                type="issue"
                event={$selected_issue.event}
                replies={$selected_issue_replies}
              />
            {/if}
          </div>
        </div>
        <div class="prose ml-2 hidden w-1/3 lg:flex">
          <ProposalDetails type="issue" issue_or_pr={selected_issue} />
        </div>
      </div>
    </Container>
  {/if}
</RepoPageWrapper>
