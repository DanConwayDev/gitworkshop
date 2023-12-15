import type { Args as PRListItemArgs } from "./PRsListItem.svelte";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

export let PRsListItemArgsVectors = {
    Short: {
        title: "short title",
        author: "fred",
        created_at: dayjs().subtract(7, 'days').unix(),
        comments: 2,
    } as PRListItemArgs,
    Long: {
        title: "rather long title that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on",
        author: "carole",
        created_at: dayjs().subtract(1, 'minute').unix(),
        comments: 0,
    } as PRListItemArgs,
    LongNoSpaces: {
        title: "LongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongNameLongName",
        author: "steve",
        created_at: dayjs().subtract(3, 'month').subtract(3, 'days').unix(),
        comments: 1,
    } as PRListItemArgs,
};