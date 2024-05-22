<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import { ensureIdentifierRepoCollection } from '$lib/stores/ReposIdentifier'
  import { repoEventToSummary } from '$lib/stores/repos'

  export let data: { repo_identifier: string }

  let collection = ensureIdentifierRepoCollection(data.repo_identifier || '')
</script>

<Container>
  <div class="m-5">
    <ReposSummaryList
      title={`repositories for '${data.repo_identifier}'`}
      repos={$collection.events.map(repoEventToSummary)}
      loading={$collection.loading}
    />
  </div>
</Container>
