<script lang="ts">
	import store from '$lib/store.svelte';
	import Sidebar from './Sidebar.svelte';
	import Wallet from './Wallet.svelte';

	let is_open = $state(false);
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
</script>

{#if store.logged_in_account}
	<div class="relative">
		<button
			class="btn btn-sm mt-1 h-6 px-2 pb-1 pt-1"
			class:btn-primary={is_open}
			class:btn-ghost={!is_open}
			onclick={toggle}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 512 512">
				<title>wallet</title>
				<rect
					width="416"
					height="288"
					x="48"
					y="144"
					fill="none"
					stroke="currentColor"
					stroke-linejoin="round"
					stroke-width="32"
					rx="48"
					ry="48"
				/><path
					fill="none"
					stroke="currentColor"
					stroke-linejoin="round"
					stroke-width="32"
					d="M411.36 144v-30A50 50 0 0 0 352 64.9L88.64 109.85A50 50 0 0 0 48 159v49"
				/><path fill="currentColor" d="M368 320a32 32 0 1 1 32-32a32 32 0 0 1-32 32" /></svg
			>
		</button>
		<Sidebar bind:is_open classes="w-[400px]">
			<Wallet pubkey={store.logged_in_account.pubkey} />
		</Sidebar>
	</div>
{/if}
