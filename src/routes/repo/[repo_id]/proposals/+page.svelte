<script lang="ts">
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import { proposal_summaries } from '$lib/stores/Proposals'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'

  export let data: { repo_id: string }
  let identifier = data.repo_id
</script>

<RepoPageWrapper {identifier} selected_tab="proposals">
  <ProposalsList
    proposals_or_issues={$proposal_summaries.summaries}
    loading={$proposal_summaries.loading}
  />
  <div role="alert" class="alert mt-6">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      class="h-6 w-6 shrink-0 stroke-info"
      ><path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      ></path></svg
    >
    <div>
      <h3 class="prose mb-2 text-sm font-bold">want to submit a proposal?</h3>
      <p class="prose text-xs">
        <a href="/ngit">install ngit</a>, create add a feature in the local
        repository and run
        <span class="rounded bg-neutral p-1 font-mono"
          ><span class="py-3">ngit send</span></span
        >
      </p>
    </div>
  </div>
</RepoPageWrapper>
