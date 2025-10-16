<script lang="ts">
	import { resolve } from '$app/paths';
	import store from '$lib/store.svelte';
	import Sidebar from './Sidebar.svelte';

	let is_open = $state(false);
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
</script>

<div class="navbar-start sm:hidden">
	<button aria-label="Menu" class="btn btn-ghost" onclick={toggle}>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-5 w-5"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M4 6h16M4 12h8m-8 6h16"
			/>
		</svg>
	</button>
</div>

<Sidebar bind:is_open side="left" classes="w-[200px]">
	<ul class="flex h-full w-full flex-col gap-1 py-2">
		<li class="w-full overflow-hidden rounded-md">
			<a
				href={resolve('/')}
				class="hover:bg-base-200 active:bg-base-100 flex h-10 items-center px-4 transition-colors"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mr-2 h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
					<polyline points="9 22 9 12 15 12 15 22"></polyline>
				</svg>
				<span>Home</span>
			</a>
		</li>
		<li class="w-full overflow-hidden rounded-md">
			<a
				href={resolve('/search')}
				class="hover:bg-base-200 active:bg-base-100 flex h-10 items-center px-4 transition-colors"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mr-2 h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<span>Search</span>
			</a>
		</li>
		<li class="w-full overflow-hidden rounded-md">
			<a
				href={resolve('/quick-start')}
				class="hover:bg-base-200 active:bg-base-100 flex h-10 items-center px-4 transition-colors"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="mr-2 h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
				</svg>
				<span>Quick Start</span>
			</a>
		</li>
	</ul>
</Sidebar>

<div class="navbar-start hidden sm:flex">
	<a class="h-8 overflow-hidden align-middle" href={resolve('/')}>
		<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
	</a>
	<div class="p-2"></div>
	<a href={resolve('/')} class="btn btn-ghost btn-sm hidden normal-case sm:flex">Home</a>
	<a href={resolve('/quick-start')} class="btn btn-ghost btn-sm normal-case">Quick Start</a>
</div>
