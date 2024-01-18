<script lang="ts">
    import RepoDetails from "$lib/wrappers/RepoDetails.svelte";
    import OpenPRs from "$lib/wrappers/OpenPRs.svelte";
    import { ensureSelectedRepo, selected_repo } from "$lib/stores/repo";
    import RepoHeader from "$lib/components/repo/RepoHeader.svelte";
    import Container from "$lib/components/Container.svelte";

    export let data: { repo_id: string };
    let repo_id = data.repo_id;

    ensureSelectedRepo(repo_id);

    let repo_error = false;
    $: {
        repo_error =
            !$selected_repo.loading && $selected_repo.name.length === 0;
    }
</script>

{#if repo_error}
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
            <span>Error! cannot find repository event</span>
        </div>
    </Container>
{:else}
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
{/if}
