<script lang="ts">
    import EventWrapper from "$lib/components/events/EventWrapper.svelte";
    import Kind317 from "$lib/components/events/content/Kind317.svelte";
    import type { User } from "$lib/components/users/type";
    import { defaults as user_defaults } from "$lib/components/users/type";
    import { patch_kind } from "$lib/kinds";
    import { ensureUser } from "$lib/stores/users";
    import type { NDKEvent } from "@nostr-dev-kit/ndk";
    import { onDestroy } from "svelte";
    import { writable } from "svelte/store";

    export let event: NDKEvent;

    let author = writable({ ...user_defaults });
    let author_unsubsriber = ensureUser(event.pubkey).subscribe((u) => {
        author.set({ ...u });
    });
    onDestroy(() => {
        author_unsubsriber();
    });
</script>

<EventWrapper author={$author}>
    {#if event.kind == patch_kind}
        <Kind317 content={event.content} tags={event.tags} />
    {:else}
        {event.content}
    {/if}
</EventWrapper>
