import type { Meta, StoryObj } from '@storybook/svelte';

import Navbar from '$lib/components/navbar.svelte';

// More on how to set up stories at: https://storybook.js.org/docs/svelte/writing-stories/introduction
const meta = {
  title: 'Navbar',
  component: Navbar,
  tags: ['autodocs'],
  argTypes: {
    nip07plugin: { control: 'boolean' },
  },
} satisfies Meta<Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/svelte/writing-stories/args
export const Default: Story = {
  args: {
  },
};

export const NoNIP07: Story = {
  args: {
    nip07plugin: false,
  },
};

export const NIP07Exists: Story = {
  args: {
    nip07plugin: true,
  },
};
