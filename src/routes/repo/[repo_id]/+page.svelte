<script lang="ts">
    import RepoDetails from "$lib/wrappers/RepoDetails.svelte";
    import OpenPRs from "$lib/wrappers/OpenPRs.svelte";

    export let data: { repo_id: string };
    let repo_id = data.repo_id;
</script>

<div class="flex">
    <div class="w-2/3">
        <OpenPRs {repo_id} />
    </div>
    <div class="w-1/3 prose">
        <RepoDetails {repo_id} />
    </div>
</div>
