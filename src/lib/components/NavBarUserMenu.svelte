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
		<div class="text-wrap">
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
			<ul class="-mx-4">
				{#if store.experimental}
					<li>
						<button
							class="h-10 w-full px-8 text-right hover:bg-base-200 active:bg-base-100"
							onclick={() => {
								show_feedback_modal = true;
							}}>Feedback</button
						>
					</li>
				{/if}
				<li>
					<button
						class="h-10 w-full px-8 text-right hover:bg-base-200 active:bg-base-100"
						onclick={() => {
							show_settings_modal = true;
						}}
					>
						Settings
					</button>
				</li>
				<li>
					<button
						class="h-10 w-full px-8 text-right hover:bg-base-200 active:bg-base-100"
						onclick={() => {
							accounts_manager.clearActive();
						}}>Logout</button
					>
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
