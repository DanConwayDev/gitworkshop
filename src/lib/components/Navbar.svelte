<script lang="ts">
	import { goto } from '$app/navigation';
	import accounts_manager from '$lib/accounts';
	import store, { search } from '$lib/store.svelte';
	import Container from './Container.svelte';
	import FeedbackModal from './FeedbackModal.svelte';
	import LoginModal from './LoginModal.svelte';
	import ManageAccountsModal from './ManageAccountsModal.svelte';
	import NavBarInsertOutbox from './NavBarInsertOutbox.svelte';
	import SettingsModal from './SettingsModal.svelte';
	import UserHeader from './user/UserHeader.svelte';

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

<div class="bg-base-400">
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
				{#if store.experimental}<NavBarInsertOutbox />{/if}
				{#if store.logged_in_account || store.accounts.length > 0}
					<div class="dropdown dropdown-end">
						<div tabindex="0" role="button" class="m-1">
							{#if store.logged_in_account}
								<UserHeader
									user={store.logged_in_account.pubkey}
									link_to_profile={false}
									avatar_only={true}
								/>
							{:else}
								<button class="btn btn-ghost btn-sm normal-case">Login</button>
							{/if}
						</div>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<ul
							tabindex="0"
							class="menu dropdown-content z-[1] -mr-4 min-w-max rounded-box bg-base-400 p-2 shadow"
						>
							{#each store.accounts as account}
								<li>
									<button
										class:bg-base-300={store.logged_in_account &&
											store.logged_in_account.id === account.id}
										onclick={() => {
											accounts_manager.setActive(account.id);
										}}
									>
										<UserHeader
											user={account.pubkey}
											link_to_profile={store.logged_in_account &&
												store.logged_in_account.id === account.id}
										/>
									</button>
								</li>
							{/each}
							<li>
								<button
									onclick={() => {
										show_manage_accounts_modal = true;
									}}>Manage Accounts</button
								>
							</li>
							{#if store.experimental}
								<li>
									<button
										onclick={() => {
											show_feedback_modal = true;
										}}>Feedback</button
									>
								</li>
							{/if}
							<li>
								<button
									onclick={() => {
										show_settings_modal = true;
									}}>Settings</button
								>
							</li>
							<li>
								<button
									onclick={() => {
										accounts_manager.clearActive();
									}}>Logout</button
								>
							</li>
						</ul>
					</div>
				{:else}
					<button
						onclick={() => {
							show_login_modal = true;
						}}
						class="btn btn-ghost btn-sm normal-case">Login</button
					>
				{/if}
			</div>
		</div>
	</Container>
</div>

{#if show_manage_accounts_modal}
	<ManageAccountsModal
		done={() => {
			show_manage_accounts_modal = false;
		}}
	/>
{/if}

{#if show_feedback_modal}
	<FeedbackModal
		done={() => {
			show_feedback_modal = false;
		}}
	/>
{/if}

{#if show_settings_modal}
	<SettingsModal
		done={() => {
			show_settings_modal = false;
		}}
	/>
{/if}

{#if show_login_modal}
	<LoginModal
		done={() => {
			show_login_modal = false;
		}}
	/>
{/if}
