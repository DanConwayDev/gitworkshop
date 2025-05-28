<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import ReposSummaryList from '$lib/components/repo/ReposSummaryList.svelte';
	import { onMount } from 'svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { search } from '$lib/store.svelte';
	import { isWebSocketUrl, type WebSocketUrl } from '$lib/types';
	import AlertError from '$lib/components/AlertError.svelte';
	let {
		data
	}: {
		data: { relay_url: string };
	} = $props();
	onMount(() => {
		// Set focus on the input field when the component is mounted
		const input = document.getElementById('search-field');
		if (input) {
			input.focus();
		}
	});

	let ws_url: undefined | WebSocketUrl = $derived.by(() => {
		let decoded = decodeURIComponent(data.relay_url);
		if (!decoded.includes('://')) decoded = 'wss://' + decoded;
		if (isWebSocketUrl(decoded)) {
			return decoded;
		}
		return undefined;
	});
	let loading_query = $derived(query_centre.fetchAllRepos(ws_url ? [ws_url] : undefined));
	let loading = $derived(loading_query.loading);
	let repos_query = $derived(
		query_centre.searchRepoAnns(search.text, ws_url ? [ws_url] : undefined)
	);
	let repos = $derived(repos_query.current ?? []);
</script>

<svelte:head>
	<title>GitWorkshop - {search.text}</title>
</svelte:head>

<Container>
	{#if !ws_url}
		<AlertError>
			<span class="prose"><code>{data.relay_url}</code></span> is not a Nostr Relay Url
		</AlertError>
	{:else}
		<div class="m-8 mx-auto max-w-lg">
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
					placeholder="Find Repo by Name"
					bind:value={search.text}
				/>
			</label>
		</div>
		<div class="prose"><h3>filtered by {data.relay_url}</h3></div>

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
		</div>
	{/if}
</Container>
