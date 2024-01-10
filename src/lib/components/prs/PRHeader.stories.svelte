<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import PRHeader from "./PRHeader.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { PRsListItemArgsVectors as vectors } from "./vectors";

    export const meta: Meta<PRHeader> = {
        title: "PRs/Header",
        component: PRHeader,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <PRHeader {...args} />
</Template>

<Story name="Short Details" args={vectors.Short} />

<Story name="Long Details" args={vectors.Long} />

<Story name="Long and No Spaces" args={vectors.LongNoSpaces} />

<Story name="Author Loading" args={vectors.AuthorLoading} />

<Story name="loading" args={{ loading: true }} />
