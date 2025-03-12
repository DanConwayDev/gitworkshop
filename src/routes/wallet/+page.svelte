<script lang="ts">
	import Container from '$lib/components/Container.svelte';
	import Wallet from '$lib/components/Wallet.svelte';
	import store from '$lib/store.svelte';
</script>

<svelte:head>
	<title>GitWorkshop - wallet</title>
</svelte:head>

<Container>
	{#if store.logged_in_account}
		<Wallet pubkey={store.logged_in_account.pubkey} />
	{/if}
</Container>
