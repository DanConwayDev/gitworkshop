<script lang="ts">
    import UserHeader from "../users/UserHeader.svelte";
    import type { User } from "../users/type";
    import { defaults as user_defaults } from "../users/type";

    export let author: User = { ...user_defaults };
</script>

<div class="pl-3 p-3 border-b border-base-300">
    <UserHeader user={author} />
    <div class="ml-11">
        <slot />
    </div>
</div>
