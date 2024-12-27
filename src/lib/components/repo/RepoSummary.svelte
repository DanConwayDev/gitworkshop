<script lang="ts">
	import type { RepoTableItem } from '$lib/types';

	export let repo_item: RepoTableItem | undefined = undefined;
</script>

<div>
	{#if repo_item}
		{repo_item.identifier}
	{:else}
		loading...
	{/if}
</div>
