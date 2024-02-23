<script lang="ts">
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import {
    ensureProposalSummaries,
    proposal_summaries,
  } from '$lib/stores/Proposals'

  export let repo_id: string = ''

  ensureProposalSummaries(repo_id)
</script>

<ProposalsList
  title="Open Proposals"
  proposals={$proposal_summaries.summaries}
  loading={$proposal_summaries.loading}
/>
