<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import ReposSummaryList from "./ReposSummaryList.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { RepoSummaryCardArgsVectors as vectors } from "./Repo.vectors";

    export const meta: Meta<ReposSummaryList> = {
        title: "Repo/Summary/List",
        component: ReposSummaryList,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <ReposSummaryList {...args} />
</Template>

<Story
    name="Default"
    args={{
        title: "Featured Repositories",
        repos: [vectors.Short, vectors.Long, vectors.LongNoSpaces],
    }}
/>

<Story
    name="No Title"
    args={{
        repos: [vectors.Short, vectors.Long],
    }}
/>
<Story
    name="Empty"
    args={{
        title: "Latest",
        repos: [],
    }}
/>

<Story
    name="Loading"
    args={{
        title: "Latest",
        repos: [],
        loading: true,
        tags: ["intermittent-test-success"],
    }}
/>

<Story
    name="Partially Loaded"
    args={{
        title: "Latest",
        repos: [vectors.Short, vectors.Long],
        loading: true,
        tags: ["intermittent-test-success"],
    }}
/>
