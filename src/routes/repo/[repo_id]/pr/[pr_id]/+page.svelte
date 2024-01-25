<script lang="ts">
    import { ensureSelectedRepo, selected_repo } from "$lib/stores/repo";
    import {
        ensurePRFull,
        selected_pr_full,
        selected_pr_replies,
    } from "$lib/stores/PR";
    import PrHeader from "$lib/components/prs/PRHeader.svelte";
    import RepoHeader from "$lib/components/repo/RepoHeader.svelte";
    import Thread from "$lib/wrappers/Thread.svelte";
    import PrDetails from "$lib/components/prs/PRDetails.svelte";
    import Container from "$lib/components/Container.svelte";
    import ParsedContent from "$lib/components/events/content/ParsedContent.svelte";
    import Compose from "$lib/wrappers/Compose.svelte";
    import type { NDKEvent } from "@nostr-dev-kit/ndk";

    export let data: {
        repo_id: string;
        pr_id: string;
    };

    let repo_id = data.repo_id;
    let pr_id = data.pr_id;

    ensureSelectedRepo(repo_id);
    ensurePRFull(repo_id, pr_id);

    let replies: NDKEvent[] = [];

    $: {
        replies = $selected_pr_replies.sort((a, b) =>
            a.created_at && b.created_at ? a.created_at - b.created_at : 1,
        );
    }

    let repo_error = false;
    let pr_error = false;
    $: {
        repo_error =
            !$selected_repo.loading && $selected_repo.name.length === 0;
        pr_error =
            !$selected_pr_full.summary.loading &&
            $selected_pr_full.summary.created_at === 0;
    }
</script>

{#if !repo_error}
    <RepoHeader {...$selected_repo} />
{/if}

{#if pr_error}
    <Container>
        <div role="alert" class="alert alert-error mt-6 w-full max-w-xs m-auto">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class="stroke-current shrink-0 h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                /></svg
            >
            <span
                >Error! cannot find PR {repo_error ? "or repo " : ""}event</span
            >
        </div>
    </Container>
{:else}
    <PrHeader {...$selected_pr_full.summary} />
    <Container>
        <div class="md:flex">
            <div class="md:w-2/3 md:mr-2">
                <div class="prose my-3">
                    <ParsedContent
                        content={$selected_pr_full.summary.descritpion}
                    />
                </div>
                <div role="alert" class="alert">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        class="stroke-info shrink-0 w-6 h-6"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path></svg
                    >
                    <div>
                        <h3 class="text-xs prose">
                            to view the latest patches from this PR <a
                                href="/ngit">install ngit</a
                            >, run
                            <span class="rounded p-1 bg-neutral font-mono"
                                ><span class="py-3">ngit prs list</span></span
                            > from the local repository and select this PR title
                        </h3>
                    </div>
                </div>
                {#each $selected_pr_replies as event}
                    <Thread {event} replies={[]} />
                {/each}
                <div class="my-3">
                    <Compose />
                </div>
            </div>
            <div class="w-1/3 ml-2 prose hidden md:flex">
                <PrDetails
                    summary={$selected_pr_full.summary}
                    labels={$selected_pr_full.labels}
                    loading={$selected_pr_full.loading}
                />
            </div>
        </div>
    </Container>
{/if}
