<script>
	import Container from './Container.svelte';
	let { msg } = $props();
</script>

<div class="border-accent-content bg-error text-accent-content border-b">
	<Container no_wrap={true}>
		<div class="flex items-center justify-between p-3 py-1">
			<div class="flex-1 text-left text-xs font-semibold">Offline Mode</div>
			<div class="text-right text-xs">{msg}</div>
		</div>
	</Container>
</div>
