<script lang="ts">
    import dayjs from "dayjs";
    import UserHeader from "../users/UserHeader.svelte";
    import type { User } from "../users/type";
    import { defaults as user_defaults } from "../users/type";

    export let author: User = { ...user_defaults };
    export let created_at: number | undefined;
    let created_at_ago = "";
    $: created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : "";
</script>

<div class="pl-3 p-3 border-b border-base-300">
    <div class="flex">
        <div class="flex-auto">
            <UserHeader user={author} />
        </div>
        <div class="text-xs mt-3">{created_at_ago}</div>
    </div>
    <div class="ml-11">
        <slot />
    </div>
</div>
