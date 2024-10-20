<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import db from '$lib/dbs/LocalDb'
  import { liveQuery } from 'dexie'

  export let data: { repo_identifier: string }
  // TODO fetch from relays
  $: repos = liveQuery(async () => {
    return await db.repos
      .where('identifier')
      .equals(data.repo_identifier)
      .toArray()
  })
</script>

<Container>
  <div class="m-5">
    <ReposSummaryList
      title={`repositories for '${data.repo_identifier}'`}
      repos={$repos}
    />
  </div>
</Container>
