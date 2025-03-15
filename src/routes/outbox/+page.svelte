<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import Outbox from '$lib/components/Outbox.svelte';
</script>

<svelte:head>
	<title>GitWorkshop - outbox</title>
</svelte:head>

<Container>
	<div class="prose mt-3">
		<h3>Outbox</h3>
	</div>
	<Outbox />
</Container>
