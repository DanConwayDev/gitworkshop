<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import InstallNgit from '$lib/components/InstallNgit.svelte';
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
