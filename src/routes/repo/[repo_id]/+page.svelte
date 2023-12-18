<script lang="ts">
    import OpenPRs from "$lib/wrappers/OpenPRs.svelte";

    export let data: { repo_id: string };
    let repo_id = data.repo_id;
</script>

<OpenPRs {repo_id} />
