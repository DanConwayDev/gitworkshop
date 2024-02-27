<script lang="ts">
  import ProposalsList from '$lib/components/proposals/ProposalsList.svelte'
  import {
    ensureProposalSummaries,
    proposal_summaries,
  } from '$lib/stores/Proposals'

  ensureProposalSummaries(undefined)
  let limit = 6
  let allow_more = true
</script>

<ProposalsList
  title="Recent Proposals"
  proposals={$proposal_summaries.summaries}
  show_repo={true}
  loading={$proposal_summaries.loading}
  {limit}
  {allow_more}
/>
