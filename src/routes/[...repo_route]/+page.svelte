<script lang="ts">
	import AboutPage from '$lib/components/repo/AboutPage.svelte';
	import UserPage from '$lib/components/user/UserPage.svelte';
	import type { RepoRouteData } from '$lib/types';

	let { data }: { data: RepoRouteData } = $props();
</script>

{#if data.repo_route}
	<AboutPage />
{:else if data.user_route}
	<UserPage user_route={data.user_route} />
{/if}
