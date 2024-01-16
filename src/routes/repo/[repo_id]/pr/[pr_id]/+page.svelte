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

    export let data: {
        repo_id: string;
        pr_id: string;
    };

    let repo_id = data.repo_id;
    let pr_id = data.pr_id;

    ensureSelectedRepo(repo_id);
    ensurePRFull(repo_id, pr_id);
</script>

<RepoHeader {...$selected_repo} />
<PrHeader {...$selected_pr_full.summary} />

<Container>
    <div class="md:flex">
        <div class="md:w-2/3 md:mr-2">
            <div class="prose my-3">
                {$selected_pr_full.summary.descritpion}
            </div>
            {#if $selected_pr_full.pr_event}
                <Thread
                    event={$selected_pr_full.pr_event}
                    replies={$selected_pr_replies}
                />
            {/if}
        </div>
        <div class="w-1/3 ml-2 prose hidden md:flex">
            <PrDetails
                summary={$selected_pr_full.summary}
                status={$selected_pr_full.status}
                labels={$selected_pr_full.labels}
                loading={$selected_pr_full.loading}
            />
        </div>
    </div>
</Container>
