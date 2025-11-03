<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import ReposSummaryList from '$lib/components/repo/ReposSummaryList.svelte';
	import { onMount } from 'svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { search } from '$lib/store.svelte';

	const ITEMS_PER_PAGE = 12;
	let items_to_show = $state(ITEMS_PER_PAGE);
	let sentinel: HTMLDivElement | undefined = $state();

	onMount(() => {
		// Set focus on the input field when the component is mounted
		const input = document.getElementById('search-field');
		if (input) {
			input.focus();
		}
	});

	// Set up intersection observer for lazy loading when sentinel is available
	$effect(() => {
		if (!sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting && items_to_show < all_repos.length) {
						items_to_show = Math.min(items_to_show + ITEMS_PER_PAGE, all_repos.length);
					}
				});
			},
			{ rootMargin: '100px' }
		);

		observer.observe(sentinel);

		return () => {
			observer.disconnect();
		};
	});

	let loading_query = $derived(query_centre.fetchAllRepos());
	let loading = $derived(loading_query.loading);
	let repos_query = $derived(query_centre.searchRepoAnns(search.text));
	let all_repos = $derived(repos_query.current ?? []);
	let repos = $derived(all_repos.slice(0, items_to_show));

	// Reset pagination when search text changes
	$effect(() => {
		void search.text;
		items_to_show = ITEMS_PER_PAGE;
	});
</script>

<svelte:head>
	<title>GitWorkshop - {search.text}</title>
</svelte:head>

<Container>
	<div class="m-8 mx-auto max-w-lg">
		<label class="input input-neutral flex w-full gap-2">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 16 16"
				fill="currentColor"
				class="h-6 w-6 opacity-70"
			>
				<path
					fill-rule="evenodd"
					d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
					clip-rule="evenodd"
				/>
			</svg>
			<input
				id="search-field"
				type="text"
				class="grow"
				placeholder="Find Repo by Name"
				bind:value={search.text}
			/>
		</label>
	</div>

	<div class="my-8">
		{#if repos.length > 0 || !loading}
			<ReposSummaryList
				{repos}
				title={search.text.length === 0 ? undefined : `results for: ${search.text}`}
			/>
		{/if}
		{#if loading}
			<div class="flex justify-center">
				<div class="loading loading-spinner loading-lg"></div>
			</div>
		{/if}
		{#if items_to_show < all_repos.length}
			<div bind:this={sentinel} class="flex justify-center py-8">
				<div class="loading loading-spinner loading-md"></div>
			</div>
		{/if}
	</div>
</Container>
