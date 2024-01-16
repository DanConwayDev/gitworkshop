<script lang="ts">
    import RepoDetails from "$lib/wrappers/RepoDetails.svelte";
    import OpenPRs from "$lib/wrappers/OpenPRs.svelte";
    import { ensureSelectedRepo, selected_repo } from "$lib/stores/repo";
    import RepoHeader from "$lib/components/repo/RepoHeader.svelte";
    import Container from "$lib/components/Container.svelte";

    export let data: { repo_id: string };
    let repo_id = data.repo_id;

    ensureSelectedRepo(repo_id);
</script>

<RepoHeader {...$selected_repo} />

<Container>
    <div class="md:flex mt-2">
        <div class="md:w-2/3 md:mr-2">
            <OpenPRs {repo_id} />
        </div>
        <div class="w-1/3 ml-2 prose hidden md:flex">
            <RepoDetails {repo_id} />
        </div>
    </div>
</Container>
