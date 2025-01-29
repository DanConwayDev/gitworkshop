<script lang="ts">
	import '$lib/store.svelte';
	import '$lib/accounts';

	import Navbar from '$lib/components/Navbar.svelte';
	import '../app.css';
	let { children } = $props();
</script>

<Navbar />

{@render children()}

<div class="h-10"></div>
