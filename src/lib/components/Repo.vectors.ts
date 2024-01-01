import type { Args as SummaryCardArgs } from "./RepoSummaryCard.svelte";
import type { Args as DetailsArgs } from "./RepoDetails.svelte";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import type { User } from "./users/type";
import { UserVectors, withName } from "./users/vectors";

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
        withName(UserVectors.default, "carole"),
        withName(UserVectors.default, "bob"),
        withName(UserVectors.default, "steve"),
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
    MaintainersOneProfileNotLoaded: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.loading },
            { ...base.maintainers[2] },
        ]
    } as DetailsArgs,
    MaintainersOneProfileDisplayNameWithoutName: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.display_name_only },
            { ...base.maintainers[2] },
        ]
    } as DetailsArgs,
    MaintainersOneProfileNameAndDisplayNamePresent: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.display_name_and_name },
            { ...base.maintainers[2] },
        ]
    } as DetailsArgs,
    MaintainersOneProfileNoNameOrDisplayNameBeingPresent: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.no_profile },
            { ...base.maintainers[2] },

        ]
    } as DetailsArgs,
    NoMaintainers: { ...base, maintainers: [] } as DetailsArgs,
    NoRelays: { ...base, relays: [] } as DetailsArgs,
    NoMaintainersOrRelays: { ...base, maintainers: [], relays: [] } as DetailsArgs,
};