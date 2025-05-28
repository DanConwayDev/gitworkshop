<script lang="ts">
	import ComposeIssue from '$lib/components/compose/ComposeIssue.svelte';
	import Container from '$lib/components/Container.svelte';
	import store from '$lib/store.svelte';
	import type { RepoRef } from '$lib/types';
	import { routeToRepoRef } from '$lib/types';

	let a_ref: RepoRef | undefined = $derived(routeToRepoRef(store.route));
	let hint_relays = $derived(store.route?.relays);
</script>

{#if a_ref}
	<Container>
		<div class="mt-2 lg:flex">
			<div class="prose lg:mr-2 lg:w-2/3">
				<h4>Create Issue</h4>
				<ComposeIssue {a_ref} {hint_relays} />
			</div>
		</div>
	</Container>
{/if}
