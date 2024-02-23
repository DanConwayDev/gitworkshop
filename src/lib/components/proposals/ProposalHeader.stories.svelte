<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import ProposalHeader from './ProposalHeader.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { ProposalsListItemArgsVectors as vectors } from './vectors'

  export const meta: Meta<ProposalHeader> = {
    title: 'Proposals/Header',
    component: ProposalHeader,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <ProposalHeader {...args} />
</Template>

<Story name="Short Details" args={vectors.Short} />

<Story name="Long Details" args={vectors.Long} />

<Story name="Long and No Spaces" args={vectors.LongNoSpaces} />

<Story name="Author Loading" args={vectors.AuthorLoading} />

<Story name="loading" args={{ loading: true }} />
