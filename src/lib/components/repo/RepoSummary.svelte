<script lang="ts">
	import type { RepoAnn, SeenOn } from '$lib/dbs/types';

	export let repo_ann: (RepoAnn & SeenOn) | undefined = undefined;
</script>

<div>
	{#if repo_ann}
		{repo_ann.identifier}
	{:else}
		loading...
	{/if}
</div>
