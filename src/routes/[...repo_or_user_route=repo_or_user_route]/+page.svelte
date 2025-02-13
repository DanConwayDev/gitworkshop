<script lang="ts">
	import NotFound404Page from '$lib/components/NotFound404Page.svelte';
import AboutPage from '$lib/components/repo/AboutPage.svelte';
	import UserPage from '$lib/components/user/UserPage.svelte';
	import { isRepoRouteData, isUserRouteData, type RouteData } from '$lib/types';

	let { data }: { data: RouteData } = $props();
</script>

{#if isRepoRouteData(data)}
	<AboutPage />
{:else if isUserRouteData(data)}
	<UserPage user_route={data.user_route} />
{:else}
	<NotFound404Page />
{/if}
