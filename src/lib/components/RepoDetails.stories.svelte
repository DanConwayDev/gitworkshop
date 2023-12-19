<script lang="ts" context="module">
    import type { Meta } from "@storybook/svelte";
    import RepoDetails from "./RepoDetails.svelte";
    import { Story, Template } from "@storybook/addon-svelte-csf";
    import { RepoDetailsArgsVectors as vectors } from "./Repo.vectors";

    export const meta: Meta<RepoDetails> = {
        title: "Repo/Details",
        component: RepoDetails,
        tags: ["autodocs"],
    };
</script>

<Template let:args>
    <RepoDetails {...args} />
</Template>

<Story name="Short Details" args={vectors.NoMaintainers} />

<Story name="Long Details" args={vectors.Long} />

<Story name="Long and No Spaces" args={vectors.LongNoSpaces} />

<Story name="No Name or Description" args={vectors.NoNameOrDescription} />

<Story name="No Description" args={vectors.NoDescription} />

<Story name="No Tags" args={vectors.NoTags} />

<Story name="No Maintainers" args={vectors.NoMaintainers} />

<Story
    name="One Maintainer's Profile Not Loaded"
    args={vectors.MaintainersOneProfileNotLoaded}
/>

<Story
    name="One Maintainer's Profile Only Has displayName But No Name"
    args={vectors.MaintainersOneProfileDisplayNameWithoutName}
/>

<Story
    name="One Maintainer's Profile Has No displayName or Name"
    args={vectors.MaintainersOneProfileNoNameOrDisplayNameBeingPresent}
/>

<Story name="No Relays" args={vectors.NoRelays} />

<Story name="No Maintainers or Relays" args={vectors.NoMaintainersOrRelays} />

<Story name="loading" args={{ loading: true }} />
