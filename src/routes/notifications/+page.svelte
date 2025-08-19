<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import NotificationTable from '$lib/components/NotificationTable.svelte';
</script>

<svelte:head>
	<title>gitworkshop.dev</title>
</svelte:head>

<Container>
	<div class="my-3">
		<NotificationTable />
	</div>
</Container>
