<script lang="ts">
	import ContainerCenterPage from './ContainerCenterPage.svelte';

	let {
		msg,
		repo_header_on_page = false
	}: { msg?: string | undefined; repo_header_on_page?: boolean } = $props();

	let use_msg = $derived(msg ? msg : 'Sorry, the page you are looking for does not exist.');
</script>

<ContainerCenterPage {repo_header_on_page}>
	<div class="text-center">
		<h1 class="mb-2 text-9xl font-bold">404</h1>
		<h3 class="mb-4 text-2xl font-bold">Not Found</h3>
		<p class="text-neutral-content mt-2 mb-4">{use_msg}</p>
	</div>
</ContainerCenterPage>
