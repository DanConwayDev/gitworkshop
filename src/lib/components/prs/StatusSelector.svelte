<script lang="ts">
    import { ndk } from "$lib/stores/ndk";
    import { NDKEvent, NDKRelaySet, type NDKTag } from "@nostr-dev-kit/ndk";
    import type { PRStatus } from "./type";
    import { selected_pr_full } from "$lib/stores/PR";
    import { load } from "../../../routes/repo/[repo_id]/+page";
    import { patch_kind } from "$lib/kinds";
    import { getLoggedInUserRelays, logged_in_user } from "$lib/stores/users";
    import { selected_repo } from "$lib/stores/repo";

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
        let event = new NDKEvent(ndk);
        event.kind = patch_kind;
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
            let user_relays = await getLoggedInUserRelays();
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
    <div class="skeleton w-28 h-8 rounded-md"></div>
{:else}
    <div class="dropdown">
        <div
            tabIndex={0}
            role="button"
            class:btn-success={status === "Open"}
            class:btn-primary={status === "Merged"}
            class:btn-neutral={status === "Draft" || status === "Closed"}
            class:cursor-default={edit_mode}
            class="btn btn-success btn-sm mr-6 align-middle"
        >
            {#if status === "Open"}
                <!-- http://icon-sets.iconify.design/octicon/git-pull-request-16/ -->
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 18 18"
                    class="h-5 w-5 pt-1 flex-none fill-success-content"
                    ><path
                        d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25m5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354M3.75 2.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m0 9.5a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m8.25.75a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0"
                    />
                </svg>
                Open
            {:else if status === "Merged"}
                <!-- https://icon-sets.iconify.design/octicon/git-merge-16/ -->
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    class="h-5 w-5 pt-1 flex-none fill-primary-content"
                    ><path
                        d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218M4.25 13.5a.75.75 0 1 0 0-1.5a.75.75 0 0 0 0 1.5m8.5-4.5a.75.75 0 1 0 0-1.5a.75.75 0 0 0 0 1.5M5 3.25a.75.75 0 1 0 0 .005z"
                    /></svg
                >
                Merged
            {:else if status === "Closed"}
                <!-- https://icon-sets.iconify.design/octicon/git-pull-request-closed-16/ -->
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    class="h-5 w-5 pt-1 flex-none fill-neutral-content"
                    ><path
                        d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1m9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75m-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97l.97-.97a.748.748 0 0 1 1.265.332a.75.75 0 0 1-.205.729l-.97.97l.97.97a.751.751 0 0 1-.018 1.042a.751.751 0 0 1-1.042.018l-.97-.97l-.97.97a.749.749 0 0 1-1.275-.326a.749.749 0 0 1 .215-.734l.97-.97l-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0M3.25 12a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m9.5 0a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5"
                    /></svg
                >
                Closed
            {:else if status === "Draft"}
                <!-- https://icon-sets.iconify.design/octicon/git-pull-request-draft-16// -->
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    class="h-5 w-5 pt-1 flex-none fill-neutral-content"
                    ><path
                        d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1m9.5 14a2.25 2.25 0 1 1 0-4.5a2.25 2.25 0 0 1 0 4.5M2.5 3.25a.75.75 0 1 0 1.5 0a.75.75 0 0 0-1.5 0M3.25 12a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5m9.5 0a.75.75 0 1 0 0 1.5a.75.75 0 0 0 0-1.5M14 7.5a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 0 1 2.5 0m0-4.25a1.25 1.25 0 1 1-2.5 0a1.25 1.25 0 0 1 2.5 0"
                    /></svg
                >
                Draft
            {/if}
            {#if edit_mode}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    class="h-5 w-5s flex-none fill-success-content"
                    ><path
                        fill="currentColor"
                        d="M11.646 15.146L5.854 9.354a.5.5 0 0 1 .353-.854h11.586a.5.5 0 0 1 .353.854l-5.793 5.792a.5.5 0 0 1-.707 0"
                    /></svg
                >
            {/if}
        </div>
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
