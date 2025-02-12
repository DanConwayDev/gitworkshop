<script lang="ts">
	import ActionLauncher from '$lib/components/dvm-actions/ActionLauncher.svelte';
	import store from '$lib/store.svelte';
	import { routeToRepoRef, type RepoRef } from '$lib/types';

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));
</script>

{#if a_ref}
	<ActionLauncher {a_ref} />
{/if}
