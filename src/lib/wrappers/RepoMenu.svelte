<script lang="ts">
  import { issue_summaries } from '$lib/stores/Issues'
  import { proposal_summaries } from '$lib/stores/Proposals'
  import { selected_repo_readme } from '$lib/stores/repo'

  export let selected_tab: '' | 'proposals' | 'issues' = ''
  export let identifier = ''
</script>

<div class="flex border-b border-base-400">
  <div role="tablist" class="tabs tabs-bordered flex-none">
    {#if !$selected_repo_readme.failed}
      <a
        href={`/repo/${identifier}`}
        class="tab"
        class:tab-active={selected_tab === ''}
      >
        About
      </a>
    {/if}
    <a
      href={`/repo/${identifier}/proposals`}
      class="tab"
      class:tab-active={selected_tab === 'proposals'}
    >
      Proposals
      {#if !$proposal_summaries.loading}
        <span class="pl-1 opacity-30">
          ({$proposal_summaries.summaries.length})
        </span>
      {/if}
    </a>
    <a
      href={`/repo/${identifier}/issues`}
      class="tab"
      class:tab-active={selected_tab === 'issues'}
    >
      Issues
      {#if !$issue_summaries.loading}
        <span class="pl-1 opacity-30">
          ({$issue_summaries.summaries.length})
        </span>
      {/if}
    </a>
  </div>
  <div class="flex-grow"></div>
</div>
