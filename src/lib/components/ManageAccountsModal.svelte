<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import store from '$lib/store.svelte';
	import LoginModal from './LoginModal.svelte';
	import UserHeader from './user/UserHeader.svelte';
	let { done }: { done: () => void } = $props();

	let show_login_modal = $state(false);
</script>

<div class="modal modal-open">
	<div class="modal-box max-w-lg text-wrap">
		<div class="prose mb-5"><h3>Manage Accounts</h3></div>
		{#each store.accounts as account}
			<div
				class="flex items-center rounded-lg p-2"
				class:bg-base-300={store.logged_in_account?.id === account.id}
			>
				<button
					class="flex flex-grow"
					onclick={() => {
						accounts_manager.setActive(account.id);
					}}
				>
					<div>
						<UserHeader user={account.pubkey} link_to_profile={false} />
					</div>
					<div class="flex-grow"></div>
				</button>
				<div class="px-3 text-sm text-neutral-content">{account.type}</div>
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
		<button
			class="btn btn-ghost btn-sm mt-2 normal-case"
			onclick={() => {
				show_login_modal = true;
			}}>Add Account</button
		>

		<div class="modal-action">
			<button class="btn btn-sm" onclick={done}>Close</button>
		</div>
	</div>
</div>

{#if show_login_modal}
	<LoginModal
		done={() => {
			show_login_modal = false;
		}}
	/>
{/if}
