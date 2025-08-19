<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import store from '$lib/store.svelte';
	import { onMount } from 'svelte';
	import LoginModal from './LoginModal.svelte';
	import UserHeader from './user/UserHeader.svelte';
	let { done }: { done: () => void } = $props();

	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (!show_login_modal && event.key === 'Escape') done();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (
				!show_login_modal &&
				target.classList.contains('modal-open') &&
				!target.classList.contains('modal-box')
			)
				done();
		});
	});
	let show_login_modal = $state(false);
</script>

<dialog class="modal modal-open">
	<div class="modal-box max-w-lg text-wrap">
		<div class="prose mb-5"><h3>Manage Accounts</h3></div>
		{#each store.accounts as account (account.id)}
			<div
				class="flex items-center rounded-lg p-2"
				class:bg-base-300={store.logged_in_account?.id === account.id}
			>
				{#if store.logged_in_account?.id === account.id}
					<div class="flex grow">
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
							<div class="flex h-full grow items-center justify-center">
								<button
									class="btn btn-ghost btn-sm mt-2 normal-case"
									onclick={() => {
										accounts_manager.clearActive();
									}}>Logout</button
								>
							</div>
						{/if}
					</div>
					<div class="text-neutral-content px-3 text-sm">{account.type}</div>
				{:else}
					<button
						class="flex grow items-center"
						onclick={() => {
							accounts_manager.setActive(account.id);
						}}
					>
						<div>
							<UserHeader user={account.pubkey} link_to_profile={false} />
						</div>
						<div class="grow"></div>
						<div class="text-neutral-content px-3 text-sm">{account.type}</div>
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
				}}>Add Account</button
			>

			<div class="grow"></div>
		</div>

		<div class="modal-action">
			<button class="btn btn-sm" onclick={done}>Close</button>
		</div>
	</div>
</dialog>

{#if show_login_modal}
	<LoginModal
		done={() => {
			show_login_modal = false;
		}}
	/>
{/if}
