<script lang="ts">
  import Container from '$lib/components/Container.svelte'
  import ReposSummaryList from '$lib/components/ReposSummaryList.svelte'
  import db from '$lib/dbs/LocalDb'
  import relays_manager from '$lib/stores/RelaysManager'
  import { liveQuery } from 'dexie'

  relays_manager.fetchAllRepos()

  $: all_repos = liveQuery(() => {
    // TODO: check when last refershed repos for relays
    // call button
    return db.repos.toArray()
  })
</script>

<svelte:head>
  <title>GitWorkshop - Repos</title>
</svelte:head>

<Container>
  <div class="mt-3">
    <ReposSummaryList
      title="Explore Repositories"
      repos={$all_repos}
      group_by="name"
    />
  </div>
</Container>
