<script lang="ts">
    import type { User } from "$lib/components/users/type";
    import { defaults as user_defaults } from "$lib/components/users/type";
    import { ndk } from "$lib/stores/ndk";
    import { ensureUser } from "$lib/stores/users";
    import type { NDKEvent } from "@nostr-dev-kit/ndk";
    import { onDestroy } from "svelte";
    import EventCard from "./EventCard.svelte";
    import ThreadWrapper from "$lib/components/events/ThreadWrapper.svelte";

    export let event: NDKEvent;

    let replies = ndk.storeSubscribe({
        "#e": [event.id],
    });
</script>

<EventCard {event} />

<ThreadWrapper>
    {#each $replies as event}
        <EventCard {event} />
    {/each}
</ThreadWrapper>
