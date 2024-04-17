<script lang="ts">
  import { issue_icon_path } from '$lib/components/issues/icons'
  import { proposal_icon_path } from '$lib/components/proposals/icons'
  import type { RepoPage } from '$lib/components/repo/type'
  import { proposal_status_open } from '$lib/kinds'
  import { issue_summaries } from '$lib/stores/Issues'
  import { proposal_summaries } from '$lib/stores/Proposals'
  import { selected_repo_readme } from '$lib/stores/repo'

  export let selected_tab: RepoPage = 'about'
  export let identifier = ''
</script>

<div class="flex border-b border-base-400">
  <div role="tablist" class="tabs tabs-bordered flex-none">
    {#if !$selected_repo_readme.failed}
      <a
        href={`/repo/${identifier}`}
        class="tab"
        class:tab-active={selected_tab === 'about'}
      >
        About
      </a>
    {/if}
    <a
      href={`/repo/${identifier}/proposals`}
      class="tab"
      class:tab-active={selected_tab === 'proposals'}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
      >
        <path d={proposal_icon_path.open_pull} />
      </svg>
      Proposals
      {#if !$proposal_summaries.loading && $proposal_summaries.summaries.filter((s) => s.status === proposal_status_open).length > 0}
        <span class="badge badge-neutral badge-sm ml-2">
          {$proposal_summaries.summaries.filter(
            (s) => s.status === proposal_status_open
          ).length}
        </span>
      {/if}
    </a>
    <a
      href={`/repo/${identifier}/issues`}
      class="tab"
      class:tab-active={selected_tab === 'issues'}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        class="mb-1 mr-1 h-4 w-4 flex-none fill-base-content pt-1 opacity-50"
      >
        {#each issue_icon_path.open as p}
          <path d={p} />
        {/each}
      </svg>
      Issues
      {#if !$issue_summaries.loading && $issue_summaries.summaries.filter((s) => s.status === proposal_status_open).length > 0}
        <span class="badge badge-neutral badge-sm ml-2">
          {$issue_summaries.summaries.filter(
            (s) => s.status === proposal_status_open
          ).length}
        </span>
      {/if}
    </a>
  </div>
  <div class="flex-grow"></div>
</div>
