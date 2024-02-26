<script lang="ts">
  import RepoDetails from '$lib/components/repo/RepoDetails.svelte'
  import {
    ensureSelectedRepoCollection,
    selected_repo_event,
  } from '$lib/stores/repo'

  export let repo_id = ''

  ensureSelectedRepoCollection(repo_id)
</script>

<RepoDetails {...$selected_repo_event} />
