<script lang="ts">
	import { goto } from '$app/navigation';
	import store, { search } from '$lib/store.svelte';
	import Container from './Container.svelte';
	import LoginModal from './LoginModal.svelte';
	import NavBarInsertOutbox from './NavBarInsertOutbox.svelte';
	import NavBarUserMenu from './NavBarUserMenu.svelte';

	// this was be an import from users store
	let show_login_modal = $state(false);
	let show_manage_accounts_modal = $state(false);
	let show_settings_modal = $state(false);
	let show_feedback_modal = $state(false);
	let search_input = $state(search.text);
	function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		search.text = search_input;
		if (search_input.length > 0) goto(`/search`);
	}
</script>

{#if store.navbar_fixed}
	<div class="h-16"></div>
{/if}

<div class="bg-base-400 {store.navbar_fixed ? 'fixed left-0 top-0 z-10 w-full' : ''}">
	<Container>
		<div class="navbar">
			<div class="navbar-start sm:hidden">
				<div class="dropdown">
					<div tabindex="0" role="button" class="btn btn-ghost">
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
					</div>
					<ul
						class="menu dropdown-content menu-sm z-[1] mt-3 w-52 rounded-box bg-base-400 p-2 shadow"
					>
						<li><a href="/" class="">Home</a></li>
						<li><a href="/search" class="">Search</a></li>
						<li><a href="/quick-start" class="">Quick Start</a></li>
					</ul>
				</div>
			</div>
			<div class="navbar-start hidden sm:flex">
				<a class="h-8 overflow-hidden align-middle" href="/">
					<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
				</a>
				<div class="p-2"></div>
				<a href="/" class="btn btn-ghost btn-sm hidden normal-case sm:flex">Home</a>
				<a href="/quick-start" class="btn btn-ghost btn-sm normal-case">Quick Start</a>
			</div>
			<div class="navbar-cente">
				<a class="h-8 overflow-hidden align-middle sm:hidden" href="/">
					<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
				</a>
			</div>
			<div class="navbar-end gap-4">
				<form onsubmit={handleSearch} class="hidden sm:flex">
					<label class="input input-sm input-bordered flex items-center gap-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="h-4 w-4 opacity-70"
						>
							<path
								fill-rule="evenodd"
								d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
								clip-rule="evenodd"
							/>
						</svg>
						<input
							type="text"
							class="grow"
							placeholder="Find Repo by Name"
							bind:value={search_input}
						/>
					</label>
				</form>
				<a href="/wallet" class="btn btn-ghost btn-sm mx-0">
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
				</a>
				{#if store.experimental}<NavBarInsertOutbox />{/if}

				{#if store.logged_in_account || store.accounts.length > 0}
					<NavBarUserMenu />
				{/if}
			</div>
		</div>
	</Container>
</div>

{#if show_login_modal}
	<LoginModal
		done={() => {
			show_login_modal = false;
		}}
	/>
{/if}
