<script lang="ts">
	import { resolve } from '$app/paths';
	import Container from '$lib/components/Container.svelte';
	import InstallNgit from '$lib/components/InstallNgit.svelte';
</script>

<svelte:head>
	<title>GitWorkshop - ngit</title>
</svelte:head>

<Container>
	<div class="prose m-auto mt-8">
		<h2>Install ngit</h2>
		<InstallNgit />
		<p>Consider reviewing the <a href={resolve('/quick-start')}>quick start guide</a></p>
	</div></Container
>
