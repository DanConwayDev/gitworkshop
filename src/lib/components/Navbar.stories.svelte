<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import Navbar from "$lib/components/Navbar.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";

    export const meta: Meta<Navbar> = {
        title: "Navbar",
        component: Navbar,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <Navbar {...args} />
</Template>

<Story name="Default" />

<Story name="NoNIP07" args={{ nip07plugin: false }} />

<Story name="NIP07Exists" args={{ nip07plugin: true }} />
