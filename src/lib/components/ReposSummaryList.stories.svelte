<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import ReposSummaryList from './ReposSummaryList.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { RepoSummaryCardArgsVectors as vectors } from './repo/vectors'

  export const meta: Meta<ReposSummaryList> = {
    title: 'Repo/Summary/List',
    component: ReposSummaryList,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <ReposSummaryList {...args} />
</Template>

<Story
  name="Default"
  args={{
    title: 'Featured Repositories',
    repos: [
      vectors.Short,
      vectors.Long,
      vectors.LongNoSpaces,
      vectors.MulipleMaintainers,
    ],
  }}
/>

<Story
  name="No Title"
  args={{
    repos: [vectors.Short, vectors.Long],
  }}
/>
<Story
  name="Empty"
  args={{
    title: 'Latest',
    repos: [],
  }}
/>

<Story
  name="Loading"
  args={{
    title: 'Latest',
    repos: [],
    loading: true,
  }}
/>

<Story
  name="Partially Loaded"
  args={{
    title: 'Latest',
    repos: [vectors.Short, vectors.Long],
    loading: true,
  }}
/>

<Story
  name="Multiple Maintainers"
  args={{
    title: 'Multiple Maintainers',
    repos: [vectors.MulipleMaintainers, vectors.Long],
  }}
/>
