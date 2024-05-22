<script lang="ts">
  import {
    ensureIssueFull,
    selected_issue_full,
    selected_issue_replies,
  } from '$lib/stores/Issue'
  import Thread from '$lib/wrappers/Thread.svelte'
  import Container from '$lib/components/Container.svelte'
  import ProposalHeader from '$lib/components/proposals/ProposalHeader.svelte'
  import ProposalDetails from '$lib/components/proposals/ProposalDetails.svelte'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'
  import { naddrToRepoA, neventOrNoteToHexId } from '$lib/components/repo/utils'

  export let data: {
    repo_naddr: string
    issue_nip19: string
  }

  let repo_naddr = data.repo_naddr
  let a = ''
  $: {
    const a_result = naddrToRepoA(repo_naddr)
    if (a_result) a = a_result
  }

  let issue_nip19 = data.issue_nip19
  let issue_id = ''
  let invalid_issue_ref = false
  $: {
    const issue_nip19_result = neventOrNoteToHexId(issue_nip19)

    if (issue_nip19_result) {
      issue_id = issue_nip19_result
      invalid_issue_ref = false
      ensureIssueFull(a, issue_id)
    } else {
      invalid_issue_ref = true
    }
  }

  let repo_error = false
  let issue_error = false
  $: {
    issue_error =
      !$selected_issue_full.summary.loading &&
      $selected_issue_full.summary.created_at === 0
  }

  let waited_5_secs = false
  setTimeout(() => {
    waited_5_secs = true
  }, 5000)
</script>

<RepoPageWrapper {repo_naddr} with_side_bar={false} selected_tab="issues">
  {#if invalid_issue_ref || (waited_5_secs && issue_error)}
    <Container>
      <div role="alert" class="alert alert-error m-auto mt-6 w-full max-w-xs">
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
        {#if invalid_issue_ref}<span
            >Error! invalid Issue reference: {issue_id} '{issue_nip19}'</span
          >
        {:else}
          <span
            >Error! cannot find Issue {repo_error ? 'or repo ' : ''}event</span
          >
        {/if}
      </div>
    </Container>
  {:else}
    <ProposalHeader {...$selected_issue_full.summary} />
    <Container>
      <div class="mx-auto max-w-6xl lg:flex">
        <div class="md:mr-2 lg:w-2/3">
          <div class="max-w-4xl">
            {#if $selected_issue_full.issue_event}
              <Thread
                type="issue"
                event={$selected_issue_full.issue_event}
                replies={$selected_issue_replies}
              />
            {/if}
          </div>
        </div>
        <div class="prose ml-2 hidden w-1/3 lg:flex">
          <ProposalDetails
            type="issue"
            summary={$selected_issue_full.summary}
            labels={$selected_issue_full.labels}
            loading={$selected_issue_full.loading}
          />
        </div>
      </div>
    </Container>
  {/if}
</RepoPageWrapper>
