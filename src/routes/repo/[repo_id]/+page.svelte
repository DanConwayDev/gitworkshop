<script lang="ts">
  import { selected_repo_readme } from '$lib/stores/repo'
  import SvelteMarkdown from 'svelte-markdown'
  import RepoPageWrapper from '$lib/wrappers/RepoPageWrapper.svelte'
  import { goto } from '$app/navigation'

  export let data: { repo_id: string }
  let identifier = data.repo_id

  let selected_tab: '' | 'issues' | 'proposals' = ''
  $: {
    if ($selected_repo_readme.failed === true)
      goto(`/repo/${identifier}/proposals`)
  }
</script>

<RepoPageWrapper {identifier} {selected_tab}>
  <div class="my-3 rounded-lg border border-base-400">
    <div class="border-b border-base-400 bg-base-300 px-6 py-3">
      <h4 class="">README.md</h4>
    </div>
    <div class="p-6">
      {#if $selected_repo_readme.loading}
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="skeleton my-2 h-4"></div>
        <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
        <div class="skeleton my-3 h-5 w-20"></div>
        <div class="skeleton my-2 h-4"></div>
        <div class="skeleton my-2 mb-3 h-4 w-2/3"></div>
      {:else if $selected_repo_readme.failed}
        <div>failed to load readme from git server...</div>
      {:else}
        <article class="prose prose-sm">
          <SvelteMarkdown
            options={{ gfm: true }}
            source={$selected_repo_readme.md}
          />
        </article>
      {/if}
    </div>
  </div>
</RepoPageWrapper>
