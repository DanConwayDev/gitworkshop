<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import ProposalsList from './ProposalsList.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { ProposalsListItemArgsVectors as vectors } from './vectors'

  export const meta: Meta<ProposalsList> = {
    title: 'Proposals/List/List',
    component: ProposalsList,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <ProposalsList {...args} />
</Template>

<Story
  name="Default"
  args={{
    title: 'Open Proposals',
    proposals_or_issues: [vectors.Short, vectors.Long, vectors.LongNoSpaces],
  }}
/>

<Story
  name="No Title"
  args={{
    proposals_or_issues: [vectors.Short, vectors.Long],
  }}
/>
<Story
  name="Empty"
  args={{
    title: 'Open Proposals',
    proposals_or_issues: [],
  }}
/>

<Story
  name="Loading"
  args={{
    title: 'Open Proposals',
    proposals_or_issues: [],
    loading: true,
  }}
/>

<Story
  name="Partially Loaded"
  args={{
    title: 'Open Proposals',
    proposals_or_issues: [vectors.Short, vectors.Long],
    loading: true,
  }}
/>
