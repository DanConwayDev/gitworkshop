<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import Status from './Status.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'

  export const meta: Meta<Status> = {
    title: 'Proposals/Status',
    component: Status,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <Status {...args} />
</Template>

<Story name="Open" args={{ status: 'Open' }} />

<Story name="Closed" args={{ status: 'Closed' }} />

<Story name="Draft" args={{ status: 'Draft' }} />

<Story name="Merged" args={{ status: 'Merged' }} />

<Story name="Open Edit Mode" args={{ edit_mode: true, status: 'Open' }} />

<Story name="Loading" args={{ status: undefined }} />
