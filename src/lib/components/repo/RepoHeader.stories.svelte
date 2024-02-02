<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import RepoHeader from './RepoHeader.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { RepoDetailsArgsVectors as vectors } from './vectors'

  export const meta: Meta<RepoHeader> = {
    title: 'Repo/Header',
    component: RepoHeader,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <RepoHeader {...args} />
</Template>

<Story name="Short Name" args={vectors.NoMaintainers} />

<Story name="Long Name" args={vectors.Long} />

<Story name="No Name" args={vectors.NoNameOrDescription} />

<Story name="loading" args={{ loading: true }} />
