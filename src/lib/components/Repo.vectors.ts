import type { Args as SummaryCardArgs } from "./RepoSummaryCard.svelte";

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