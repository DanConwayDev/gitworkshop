import type { Args as SummaryCardArgs } from "../RepoSummaryCard.svelte";
import type { NDKUserProfile } from "@nostr-dev-kit/ndk";
import type { User } from "../users/type";
import { UserVectors, withName } from "../users/vectors";
import type { Repo } from "./type";

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
let base: Repo = {
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
    loading: false,
};

export let RepoDetailsArgsVectors = {
    Short: { ...base, } as Repo,
    Long: {
        ...base,
        name: "Long Name that goes on and on and on and on and on and on and on and on and on",
        description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie. Nulla vitae purus nec augue accumsan facilisis sed sed ligula. Vestibulum sed risus lacinia risus lacinia molestie. Ut lorem quam, consequat eget tempus in, rhoncus vel nunc. Duis efficitur a leo vel sodales. Nam id fermentum lacus. Etiam nec placerat velit. Praesent ac consectetur est. Aenean iaculis commodo enim.\n Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis quis nisl eget turpis congue molestie.",
    } as Repo,
    LongNoSpaces: {
        ...base,
        name: "LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName",
        description:
            "LoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsumLoremipsum",
    } as Repo,
    NoNameOrDescription: { ...base, name: "", description: "" } as Repo,
    NoDescription: { ...base, description: "" } as Repo,
    NoTags: { ...base, tags: [] } as Repo,
    NoGitServer: { ...base, git_server: "" } as Repo,
    MaintainersOneProfileNotLoaded: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.loading },
            { ...base.maintainers[2] },
        ]
    } as Repo,
    MaintainersOneProfileDisplayNameWithoutName: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.display_name_only },
            { ...base.maintainers[2] },
        ]
    } as Repo,
    MaintainersOneProfileNameAndDisplayNamePresent: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.display_name_and_name },
            { ...base.maintainers[2] },
        ]
    } as Repo,
    MaintainersOneProfileNoNameOrDisplayNameBeingPresent: {
        ...base, maintainers: [
            { ...base.maintainers[0] },
            { ...UserVectors.no_profile },
            { ...base.maintainers[2] },

        ]
    } as Repo,
    NoMaintainers: { ...base, maintainers: [] } as Repo,
    NoRelays: { ...base, relays: [] } as Repo,
    NoMaintainersOrRelays: { ...base, maintainers: [], relays: [] } as Repo,
};