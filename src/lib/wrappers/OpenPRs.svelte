<script lang="ts">
  import PRsList from '$lib/components/prs/PRsList.svelte'
  import { ensurePRSummaries, pr_summaries } from '$lib/stores/PRs'

  export let repo_id: string = ''

  ensurePRSummaries(repo_id)
</script>

<PRsList
  title="Open PRs"
  prs={$pr_summaries.summaries}
  loading={$pr_summaries.loading}
/>
