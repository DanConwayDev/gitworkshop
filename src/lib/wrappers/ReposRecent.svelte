<script lang="ts">
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import {
    ensureRecentReposEvents,
    recent_repo_summaries,
    recent_repo_summaries_loading,
  } from '$lib/stores/repos'

  ensureRecentReposEvents()
</script>

<ReposSummaryList
  title="Latest Repositories"
  repos={$recent_repo_summaries}
  loading={$recent_repo_summaries_loading}
/>
