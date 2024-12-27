<script lang="ts">
	import RepoSummary from '$lib/components/repo/RepoSummary.svelte';
	import query_centre from '$lib/query-centre/QueryCentre';

	let title = 'lets go';
	let repos = query_centre.fetchAllRepos();
</script>

<svelte:head>
	<title>gitworkshop.dev</title>
</svelte:head>

<div>
	<h3>Home- {title}</h3>

	<div>Repositories:</div>
	<ul>
		{#each $repos as repo_item}
			<li>
				<RepoSummary {repo_item} />
			</li>
		{/each}
	</ul>
</div>
