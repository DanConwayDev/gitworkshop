<script lang="ts">
    import { ensureSelectedRepo, selected_repo } from "$lib/stores/repo";
    import { ensurePRFull, selected_pr_full } from "$lib/stores/PR";
    import PrHeader from "$lib/components/prs/PRHeader.svelte";
    import RepoHeader from "$lib/components/repo/RepoHeader.svelte";

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

<div class="flex">
    <div class="w-2/3 mx-2">
        <div>placeholder for PR summary</div>
        <div>placeholder for all related events</div>
    </div>
    <div class="w-1/3 mx-2 prose">
        <div>placeholder for status, tags, contributors</div>
    </div>
</div>
