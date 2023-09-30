<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import RepoSummaryCard from "./RepoSummaryCard.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { RepoSummaryCardArgsVectors as vectors } from "./Repo.vectors";

    export const meta: Meta<RepoSummaryCard> = {
        title: "Repo/Summary/Card",
        component: RepoSummaryCard,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <RepoSummaryCard {...args} />
</Template>

<Story name="Short Details" args={vectors.Short} />

<Story name="Long Details" args={vectors.Long} />

<Story name="Long and No Spaces" args={vectors.LongNoSpaces} />

<Story name="No Details" args={{}} />

<Story name="loading" args={{ loading: true }} />
