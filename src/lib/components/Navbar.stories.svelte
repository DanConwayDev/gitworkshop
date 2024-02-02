<script lang="ts" context="module">
  import type { Meta } from '@storybook/svelte'
  import Navbar from '$lib/components/Navbar.svelte'
  import { Story, Template } from '@storybook/addon-svelte-csf'
  import { UserVectors } from '$lib/components/users/vectors'

  export const meta: Meta<Navbar> = {
    title: 'Navbar',
    component: Navbar,
    tags: ['autodocs'],
  }
</script>

<Template let:args>
  <Navbar {...args} />
</Template>

<Story name="Default" />

<Story name="NIP07 Loading" args={{ nip07_plugin: undefined }} />

<Story name="NoNIP07" args={{ nip07_plugin: false }} />

<Story
  name="NIP07Exists"
  args={{ nip07_plugin: true, logged_in_user: undefined }}
/>

<Story
  name="Logged in"
  args={{ nip07_plugin: true, logged_in_user: { ...UserVectors.default } }}
/>
