<script lang="ts">
    import RepoDetails from "$lib/wrappers/RepoDetails.svelte";
    import OpenPRs from "$lib/wrappers/OpenPRs.svelte";
    import { ensureSelectedRepo, selected_repo } from "$lib/stores/repo";

    export let data: { repo_id: string };
    let repo_id = data.repo_id;

    ensureSelectedRepo(repo_id);
</script>

<h1>{$selected_repo.name}</h1>
<div class="flex">
    <div class="w-2/3">
        <OpenPRs {repo_id} />
    </div>
    <div class="w-1/3 prose">
        <RepoDetails {repo_id} />
    </div>
</div>
