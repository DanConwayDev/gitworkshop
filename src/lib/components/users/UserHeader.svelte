<script lang="ts" context="module">
    export const defaults: User = {
        hexpubkey: "",
        npub: "",
        loading: true,
    };
</script>

<script lang="ts">
    import { getName, type User } from "./type";

    export let user: User = defaults;
    let { profile, hexpubkey, loading } = user;
    let display_name = "";
    $: {
        let { profile, hexpubkey, loading } = user;
        display_name = getName(user);
    }
</script>

<div class="flex my-2">
    <div class="avatar flex-none">
        <div
            class="w-8 h-8 rounded"
            class:skeleton={!profile && loading}
            class:bg-neutral={!loading && (!profile || !profile.image)}
        >
            {#if profile && profile.image}
                <img class="my-0" src={profile.image} alt={display_name} />
            {/if}
        </div>
    </div>
    <div class="flex-auto pl-3 m-auto">
        {#if loading}
            <div class="w-24 h-4 skeleton"></div>
        {:else}
            {display_name}
        {/if}
    </div>
</div>
