<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import store from '$lib/store.svelte';
	import FeedbackModal from './FeedbackModal.svelte';
	import LoginModal from './LoginModal.svelte';
	import SettingsModal from './SettingsModal.svelte';
	import Sidebar from './Sidebar.svelte';
	import UserHeader from './user/UserHeader.svelte';

	let is_open = $state(false);
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
	let show_login_modal = $state(false);
	let show_feedback_modal = $state(false);
	let show_settings_modal = $state(false);
</script>

<div class="relative">
	{#if store.logged_in_account}
		<div class="flex h-8 items-center">
			<button onclick={toggle} class="mt-1">
				<UserHeader
					user={store.logged_in_account.pubkey}
					link_to_profile={false}
					avatar_only={true}
				/>
			</button>
		</div>
	{:else}
		<button
			class="btn btn-sm normal-case"
			class:btn-ghost={!is_open}
			class:btn-primary={is_open}
			onclick={toggle}
		>
			Login
		</button>
	{/if}

	<Sidebar bind:is_open classes="w-[500px]">
		<div class="w-full text-wrap">
			{#if store.logged_in_account}
				<div class="-mb-2">
					<UserHeader user={store.logged_in_account.pubkey} size="full" link_to_profile={false} />
				</div>
			{/if}
			<div class="prose mb-2"><h4>Accounts</h4></div>
			{#each store.accounts as account}
				<div
					class="flex items-center rounded-lg p-2"
					class:bg-base-100={store.logged_in_account?.id === account.id}
				>
					{#if store.logged_in_account?.id === account.id}
						<div class="flex flex-grow">
							<button
								onclick={() => {
									accounts_manager.setActive(account.id);
								}}
							>
								<div>
									<UserHeader user={account.pubkey} link_to_profile={false} />
								</div>
							</button>
							{#if store.logged_in_account?.id === account.id}
								<div class="flex h-full flex-grow items-center justify-center">
									<button
										class="btn btn-ghost btn-sm mt-2 normal-case"
										onclick={() => {
											accounts_manager.clearActive();
										}}>Logout</button
									>
								</div>
							{/if}
						</div>
						<div class="px-3 text-sm text-neutral-content">{account.type}</div>
					{:else}
						<button
							class="flex flex-grow items-center"
							onclick={() => {
								accounts_manager.setActive(account.id);
							}}
						>
							<div>
								<UserHeader user={account.pubkey} link_to_profile={false} />
							</div>
							<div class="flex-grow"></div>
							<div class="px-3 text-sm text-neutral-content">{account.type}</div>
						</button>
					{/if}
					<button
						class="btn btn-error btn-xs"
						onclick={() => {
							accounts_manager.removeAccount(account.id);
							if (accounts_manager.active?.id === account.id) {
								accounts_manager.clearActive();
							}
						}}>Remove</button
					>
				</div>
			{/each}
			<div class="flex">
				<button
					class="btn btn-ghost btn-sm mt-2 normal-case"
					onclick={() => {
						show_login_modal = true;
					}}>Add Another Account</button
				>

				<div class="flex-grow"></div>
			</div>
			<ul class="flex w-full flex-col gap-1 py-2">
				{#if store.experimental}
					<li class="w-full overflow-hidden rounded-md">
						<button
							class="flex h-10 w-full items-center justify-end px-4 transition-colors hover:bg-base-200 active:bg-base-100"
							onclick={() => {
								show_feedback_modal = true;
							}}
						>
							<span class="mr-2">Feedback</span>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-5 w-5"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fill-rule="evenodd"
									d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					</li>
				{/if}
				<li class="w-full overflow-hidden rounded-md">
					<button
						class="flex h-10 w-full items-center justify-end px-4 transition-colors hover:bg-base-200 active:bg-base-100"
						onclick={() => {
							show_settings_modal = true;
						}}
					>
						<span class="mr-2">Settings</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</li>
				<li class="w-full overflow-hidden rounded-md">
					<button
						class="flex h-10 w-full items-center justify-end px-4 transition-colors hover:bg-base-200 active:bg-base-100"
						onclick={() => {
							accounts_manager.clearActive();
						}}
					>
						<span class="mr-2">Logout</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm6 4a1 1 0 011 1v4.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8 12.586V8a1 1 0 011-1z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</li>
			</ul>
		</div>
	</Sidebar>
</div>

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
