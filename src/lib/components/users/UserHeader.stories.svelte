<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import UserHeader from "$lib/components/users/UserHeader.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { UserVectors as vectors } from "./vectors";

    export const meta: Meta<UserHeader> = {
        title: "Users/Header",
        component: UserHeader,
        tags: ["autodocs"],
    };
    let base = {
        hexpubkey:
            "3eb45c6f15752d796fa5465d0530a5a5feb79fb6f08c0a4176be9d73cc28c40d",
        npub: "npub18669cmc4w5khjma9gews2v995hlt08ak7zxq5stkh6wh8npgcsxslt2xjn",
    };
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
    args={{ user: { ...vectors.no_profile } }}
/>

<Story
    name="name and displayName shows name"
    args={{ user: { ...vectors.display_name_and_name } }}
/>
