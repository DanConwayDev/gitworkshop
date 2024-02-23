<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import ProposalsListItem from './ProposalsListItem.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { ProposalsListItemArgsVectors as vectors } from './vectors'

  export const meta: Meta<ProposalsListItem> = {
    title: 'Proposals/List/Item',
    component: ProposalsListItem,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <ProposalsListItem {...args} />
</Template>

<Story name="Short Details" args={vectors.Short} />

<Story name="Long Details" args={vectors.Long} />

<Story name="Long and No Spaces" args={vectors.LongNoSpaces} />

<Story name="Author Loading" args={vectors.AuthorLoading} />

<Story name="Status Loading" args={vectors.StatusLoading} />

<Story name="Status Draft" args={vectors.StatusDraft} />

<Story name="Status Closed" args={vectors.StatusClosed} />

<Story name="Status Applied" args={vectors.StatusApplied} />

<Story name="loading" args={{ loading: true }} />
