<script lang="ts">
  import {
    ensureSelectedRepoCollection,
    selected_repo_collection,
    selected_repo_event,
  } from '$lib/stores/repo'
  import {
    ensureIssueFull,
    selected_issue_full,
    selected_issue_replies,
  } from '$lib/stores/Issue'
  import RepoHeader from '$lib/components/repo/RepoHeader.svelte'
  import Thread from '$lib/wrappers/Thread.svelte'
  import Container from '$lib/components/Container.svelte'
  import ProposalHeader from '$lib/components/proposals/ProposalHeader.svelte'
  import ProposalDetails from '$lib/components/proposals/ProposalDetails.svelte'

  export let data: {
    repo_id: string
    issue_id: string
  }

  let repo_id = data.repo_id
  let issue_id = data.issue_id

  ensureSelectedRepoCollection(repo_id)
  ensureIssueFull(repo_id, issue_id)

  let repo_error = false
  let issue_error = false
  $: {
    repo_error =
      !$selected_repo_collection.loading &&
      $selected_repo_event.name.length === 0
    issue_error =
      !$selected_issue_full.summary.loading &&
      $selected_issue_full.summary.created_at === 0
  }
</script>

{#if !repo_error}
  <RepoHeader {...$selected_repo_event} />
{/if}

{#if issue_error}
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
      <span>Error! cannot find Issue {repo_error ? 'or repo ' : ''}event</span>
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
