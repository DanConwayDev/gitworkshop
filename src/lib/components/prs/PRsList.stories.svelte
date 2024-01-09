<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import PRsList from "./PRsList.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { PRsListItemArgsVectors as vectors } from "./vectors";

    export const meta: Meta<PRsList> = {
        title: "PRs/List/List",
        component: PRsList,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <PRsList {...args} />
</Template>

<Story
    name="Default"
    args={{
        title: "Open PRs",
        prs: [vectors.Short, vectors.Long, vectors.LongNoSpaces],
    }}
/>

<Story
    name="No Title"
    args={{
        prs: [vectors.Short, vectors.Long],
    }}
/>
<Story
    name="Empty"
    args={{
        title: "Open PRs",
        prs: [],
    }}
/>

<Story
    name="Loading"
    args={{
        title: "Open PRs",
        prs: [],
        loading: true,
    }}
/>

<Story
    name="Partially Loaded"
    args={{
        title: "Open PRs",
        prs: [vectors.Short, vectors.Long],
        loading: true,
    }}
/>
