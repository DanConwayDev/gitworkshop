<script lang="ts">
	import { goto } from '$app/navigation';
	import store, { search } from '$lib/store.svelte';
	import Container from './Container.svelte';
	import LoginModal from './LoginModal.svelte';
	import NavBarInsertOutbox from './NavBarInsertOutbox.svelte';
	import NavBarInsertWallet from './NavBarInsertWallet.svelte';
	import NavBarLeftMenu from './NavBarLeftMenu.svelte';
	import NavBarUserMenu from './NavBarUserMenu.svelte';

	// this was be an import from users store
	let show_login_modal = $state(false);
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
			<NavBarLeftMenu />
			<div class="navbar-cente">
				<a class="h-8 overflow-hidden align-middle sm:hidden" href="/">
					<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
				</a>
			</div>
			<div class="navbar-end md:gap-2">
				<form onsubmit={handleSearch} class="mx-2 hidden sm:flex">
					<div class="join">
						<label class="input input-sm join-item input-bordered flex items-center gap-2">
							<input
								type="text"
								class="grow"
								placeholder="Find Repo by Name"
								bind:value={search_input}
							/>
						</label>
						<button type="submit" aria-label="search" class="btn join-item input-bordered btn-sm">
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
						</button>
					</div>
				</form>
				<div class="relative sm:hidden">
					<a
						href="/search"
						aria-label="search"
						class="btn btn-ghost btn-sm mt-1 h-6 px-2 pb-1 pt-1"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="h-6 w-6"
						>
							<path
								fill-rule="evenodd"
								d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
								clip-rule="evenodd"
							/>
						</svg>
					</a>
				</div>
				{#if store.experimental}<NavBarInsertWallet />{/if}
				{#if store.experimental}<NavBarInsertOutbox />{/if}

				<NavBarUserMenu />
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
