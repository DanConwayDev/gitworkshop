<script lang="ts">
    import { ndk } from "$lib/stores/ndk";
    import { NDKEvent, NDKRelaySet, type NDKTag } from "@nostr-dev-kit/ndk";
    import type { PRStatus } from "./type";
    import { selected_pr_full } from "$lib/stores/PR";
    import { pr_status_kind } from "$lib/kinds";
    import { getUserRelays, logged_in_user } from "$lib/stores/users";
    import { selected_repo } from "$lib/stores/repo";
    import Status from "$lib/components/prs/Status.svelte";

    export let status: PRStatus = "Draft";
    export let repo_id: string = "";
    export let pr_id: string = "";

    let loading = false;

    let edit_mode = false;
    $: {
        edit_mode =
            $logged_in_user !== undefined && repo_id === $selected_repo.repo_id;
    }

    async function changeStatus(new_status: PRStatus) {
        if (!$logged_in_user) return;
        let event = new NDKEvent(ndk);
        event.kind = pr_status_kind;
        event.tags.push(["t", new_status]);
        event.tags.push(["e", pr_id]);
        event.tags.push(["r", `r-${repo_id}`]);
        loading = true;
        let relays = [...$selected_repo.relays];
        try {
            event.sign();
        } catch {
            alert("failed to sign event");
        }
        try {
            let user_relays = await getUserRelays($logged_in_user.hexpubkey);
            relays = [
                ...relays,
                ...(user_relays.ndk_relays
                    ? user_relays.ndk_relays.writeRelayUrls
                    : []),
                // TODO: pr event pubkey relays
            ];
        } catch {
            alert("failed to get user relays");
        }
        try {
            let res = await event.publish(
                NDKRelaySet.fromRelayUrls(relays, ndk),
            );
            selected_pr_full.update((pr_full) => {
                if (pr_full.summary.id !== pr_id) return pr_full;
                return {
                    ...pr_full,
                    status: new_status,
                };
            });
            loading = false;
        } catch {}
    }
</script>

{#if loading}
    <Status />
{:else}
    <div class="dropdown">
        <Status {edit_mode} {status} />
        {#if edit_mode}
            <ul
                tabIndex={0}
                class="dropdown-content z-[1] menu p-2 ml-0 shadow bg-base-300 rounded-box w-52"
            >
                {#if status !== "Draft"}
                    <li class="pl-0">
                        <button
                            on:click={() => {
                                changeStatus("Draft");
                            }}
                            class="btn btn-neutral btn-sm mx-2 align-middle"
                            >Draft</button
                        >
                    </li>
                {/if}
                {#if status !== "Open"}
                    <li class="pl-0">
                        <button
                            on:click={() => {
                                changeStatus("Open");
                            }}
                            class="btn btn-success btn-sm mx-2 align-middle"
                            >Open</button
                        >
                    </li>
                {/if}
                {#if status !== "Merged"}
                    <li class="pl-0">
                        <button
                            on:click={() => {
                                changeStatus("Merged");
                            }}
                            class="btn btn-primary btn-sm mx-2 align-middle"
                            >Merged</button
                        >
                    </li>
                {/if}
                {#if status !== "Closed"}
                    <li class="pl-0">
                        <button
                            on:click={() => {
                                changeStatus("Closed");
                            }}
                            class="btn btn-neutral btn-sm mx-2 align-middle"
                            >Closed</button
                        >
                    </li>
                {/if}
            </ul>
        {/if}
    </div>
{/if}
