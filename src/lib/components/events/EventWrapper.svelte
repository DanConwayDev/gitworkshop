<script lang="ts">
    import dayjs from "dayjs";
    import UserHeader from "../users/UserHeader.svelte";
    import type { User } from "../users/type";
    import { defaults as user_defaults } from "../users/type";
    import Compose from "$lib/wrappers/Compose.svelte";
    import { logged_in_user } from "$lib/stores/users";

    export let author: User = { ...user_defaults };
    export let created_at: number | undefined;
    export let event_id = "";
    export let logged_in = $logged_in_user;
    let show_compose = false;

    let created_at_ago = "";
    $: created_at_ago = created_at ? dayjs(created_at * 1000).fromNow() : "";
</script>

<div class="pl-3 p-3 border-b border-base-300">
    <div class="flex">
        <div class="flex-auto">
            <UserHeader user={author} />
        </div>
        {#if !show_compose}
            <div class="mt-1 mb-1 aling-middle">
                <span class="text-xs mb-1">{created_at_ago}</span>
                {#if logged_in}
                    <button
                        on:click={() => {
                            show_compose = true;
                        }}
                        class="btn btn-xs"
                        ><svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            ><path
                                fill="currentColor"
                                d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275a.749.749 0 0 1-.734-.215L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0"
                            /></svg
                        ></button
                    >
                {/if}
            </div>
        {/if}
    </div>
    <div class="ml-11">
        <slot />
        {#if show_compose}
            <div class="">
                <div class="flex">
                    <div class="flex-auto"></div>
                    <button
                        on:click={() => {
                            show_compose = false;
                        }}
                        class="btn btn-sm btn-circle btn-ghost right-2 top-2"
                        >✕</button
                    >
                </div>
                <div class="">
                    <Compose reply_to_event_id={event_id} />
                </div>
            </div>
        {/if}
    </div>
</div>
