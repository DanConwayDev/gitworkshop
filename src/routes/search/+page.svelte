<script lang="ts">
	import Container from '$lib/components/wrappers/Container.svelte';
	import ReposSummaryList from '$lib/components/repo/ReposSummaryList.svelte';
	import query_centre from '$lib/query-centre/QueryCentre';
	import { search_input, search_query } from '$lib/stores/search';
	import { onMount } from 'svelte';

	onMount(() => {
		// Set focus on the input field when the component is mounted
		const input = document.getElementById('search-field');
		if (input) {
			input.focus();
		}
	});
	$: repos = query_centre.searchRepoAnns($search_query);
	function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		search_query.set($search_input);
	}
</script>

<svelte:head>
	<title>GitWorkshop - {$search_query}</title>
</svelte:head>

<Container>
	<div class="m-8 mx-auto max-w-lg">
		<form on:submit={handleSearch}>
			<label class="input input-bordered flex items-center gap-2">
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
					placeholder="Search"
					bind:value={$search_input}
				/>
			</label>
		</form>
	</div>

	<div class="my-8">
		<ReposSummaryList
			repos={$repos}
			title={$search_query.length === 0 ? undefined : `results for: ${$search_query}`}
		/>
	</div>
</Container>
