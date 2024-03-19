<script lang="ts">
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import { issue_summaries } from '$lib/stores/Issues'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'

  export let data: { repo_id: string }
  let identifier = data.repo_id
</script>

<RepoPageWrapper {identifier} selected_tab="issues">
  <ProposalsList
    proposals_or_issues={$issue_summaries.summaries}
    loading={$issue_summaries.loading}
  />
  <a class="btn btn-success my-3" href="/repo/{identifier}/issues/new">
    create issue
  </a>
</RepoPageWrapper>
