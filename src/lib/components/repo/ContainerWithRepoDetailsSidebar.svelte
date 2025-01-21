<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import { type RepoRef, type RepoRoute, type RepoTableItem } from '$lib/types';
	import type { Snippet } from 'svelte';
	import RepoDetails from './RepoDetails.svelte';

	let {
		repo,
		a_ref,
		repo_route,
		show_details_on_mobile = true,
		children
	}: {
		repo?: RepoTableItem;
		a_ref?: RepoRef;
		repo_route: RepoRoute;
		show_details_on_mobile?: boolean;
		children: Snippet;
	} = $props();
</script>

<Container>
	<div class="mt-2 md:flex">
		<div class="md:mr-2 md:w-2/3">
			{@render children?.()}
		</div>
		<div
			class:hidden={!show_details_on_mobile}
			class=" rounded-lg border border-base-400 md:flex md:w-1/3 md:border-none"
		>
			<div class="border-b border-base-400 bg-base-300 px-6 py-3 md:hidden">
				<h4 class="">Repository Details</h4>
			</div>
			<div class="prose my-3 w-full px-6 md:ml-2 md:px-0">
				<RepoDetails {repo} {a_ref} {repo_route} />
			</div>
		</div>
	</div>
</Container>
