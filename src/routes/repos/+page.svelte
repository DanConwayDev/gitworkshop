<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import { summary_defaults } from '$lib/components/repo/type'
  import { ensureRecentRepos, recent_repos } from '$lib/stores/ReposRecent'
  import { repoEventToSummary } from '$lib/stores/repos'

  ensureRecentRepos()
</script>

<Container>
  <div class="mt-3">
    <ReposSummaryList
      title="Explore Repositories"
      repos={$recent_repos.events.map(
        (c) => repoEventToSummary(c) || { ...summary_defaults }
      )}
      group_by="name"
      loading={$recent_repos.loading}
    />
  </div>
</Container>
