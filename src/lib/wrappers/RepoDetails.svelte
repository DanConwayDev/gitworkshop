<script lang="ts">
  import RepoDetails from '$lib/components/repo/RepoDetails.svelte'
  import { ensureSelectedRepo, selected_repo } from '$lib/stores/repo'

  export let repo_id = ''

  ensureSelectedRepo(repo_id)
</script>

<RepoDetails {...$selected_repo} />
