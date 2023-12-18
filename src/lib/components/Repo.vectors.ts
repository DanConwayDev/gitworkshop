import type { Args as SummaryCardArgs } from "./RepoSummaryCard.svelte";
import type { Args as DetailsArgs } from "./RepoDetails.svelte";

export let RepoSummaryCardArgsVectors = {
    Short: {
        name: "Short Name",
        description: "short description",
    } as SummaryCardArgs,
    Long: {
        name: "Long Name that goes on and on and on and on and on and on and on and on and on",
        description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.",
    } as SummaryCardArgs,
    LongNoSpaces: {
        name: "LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName",
        description:
            "LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum>",
    } as SummaryCardArgs,
};
let base: DetailsArgs = {
    repo_id: "9ee507fc4357d7ee16a5d8901bedcd103f23c17d",
    name: "Short Name",
    description: "short description",
    git_server: "github.com/example/example",
    tags: ["svelte", "nostr", "code-collaboration", "git"],
    relays: [
        "relay.damus.io",
        "relay.snort.social",
        "relayable.org",
    ],
    maintainers: [
        "carole",
        "bob",
        "steve",
    ],
};

export let RepoDetailsArgsVectors = {
    Short: { ...base, } as DetailsArgs,
    Long: {
        ...base,
        name: "Long Name that goes on and on and on and on and on and on and on and on and on",
        description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie.",
    } as DetailsArgs,
    LongNoSpaces: {
        ...base,
        name: "LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName",
        description:
            "LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum",
    } as DetailsArgs,
    NoNameOrDescription: { ...base, name: "", description: "" } as DetailsArgs,
    NoDescription: { ...base, description: "" } as DetailsArgs,
    NoTags: { ...base, tags: [] } as DetailsArgs,
    NoMaintainers: { ...base, maintainers: [] } as DetailsArgs,
    NoRelays: { ...base, relays: [] } as DetailsArgs,
    NoMaintainersOrRelays: { ...base, maintainers: [], relays: [] } as DetailsArgs,
};