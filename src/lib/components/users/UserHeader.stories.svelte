<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import UserHeader from '$lib/components/users/UserHeader.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { UserVectors as vectors } from './vectors'

  export const meta: Meta<UserHeader> = {
    title: 'Users/Header',
    component: UserHeader,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <UserHeader {...args} />
</Template>

<Story
  name="default"
  args={{
    user: {
      ...vectors.default,
    },
  }}
/>

<Story
  name="no image"
  args={{
    user: {
      ...vectors.no_image,
    },
  }}
/>

<Story name="loading" args={{ user: { ...vectors.loading } }} />

<Story name="not found" args={{ user: { ...vectors.no_profile } }} />

<Story
  name="displayName without name"
  args={{ user: { ...vectors.display_name_only } }}
/>

<Story
  name="name and displayName shows name"
  args={{ user: { ...vectors.display_name_and_name } }}
/>
