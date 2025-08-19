<script lang="ts">
	import accounts_manager from '$lib/accounts';
	import store from '$lib/store.svelte';
	import LoginModal from './LoginModal.svelte';
	import SettingsModal from './SettingsModal.svelte';
	import Sidebar from './Sidebar.svelte';
	import UserHeader from './user/UserHeader.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import RepoSummaryCard from './repo/RepoSummaryCard.svelte';
	import { IssueOrPrStatus, type RepoTableItem } from '$lib/types';

	let is_open = $state(false);
	const toggle = () => {
		is_open = !is_open;
		store.navbar_fixed = is_open;
	};
	let show_login_modal = $state(false);
	let show_settings_modal = $state(false);

	let repos_query = $derived(
		store.logged_in_account && is_open
			? query_centre.fetchPubkeyRepos(store.logged_in_account.pubkey)
			: undefined
	);
	let repos = $derived(repos_query?.current ?? []);
	let countPRsIssues = (repo_item: RepoTableItem): number =>
		(repo_item.issues?.[IssueOrPrStatus.Open].length ?? 0) +
		(repo_item.issues?.[IssueOrPrStatus.Draft].length ?? 0) +
		(repo_item.issues?.[IssueOrPrStatus.Applied].length ?? 0) +
		(repo_item.issues?.[IssueOrPrStatus.Closed].length ?? 0) +
		(repo_item.PRs?.[IssueOrPrStatus.Open].length ?? 0) +
		(repo_item.PRs?.[IssueOrPrStatus.Draft].length ?? 0) +
		(repo_item.PRs?.[IssueOrPrStatus.Applied].length ?? 0) +
		(repo_item.PRs?.[IssueOrPrStatus.Closed].length ?? 0);
	let repos_sorted = $derived([...repos].sort((a, b) => countPRsIssues(b) - countPRsIssues(a)));
</script>

<div class="relative ml-2">
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
			onclick={() => {
				if (store.accounts.length > 0) toggle();
				else show_login_modal = true;
			}}
		>
			Login
		</button>
	{/if}

	<Sidebar bind:is_open classes="w-[500px]">
		<div class="w-full text-wrap">
			{#if store.logged_in_account}
				<div class="-mb-2">
					<UserHeader
						user={store.logged_in_account.pubkey}
						size="full"
						link_to_profile={true}
						on_link_press={() => {
							is_open = false;
						}}
					/>
				</div>
				{#if repos.length > 0}
					<div class="mb-2">
						<div class="prose mb-2"><h4>My Repositories</h4></div>
						{#each repos_sorted as repo_item (repo_item.uuid)}
							<!-- todo we need to toggle is_open -->
							<RepoSummaryCard {repo_item} lite on_go={() => toggle()} />
						{/each}
						{#if repos_query?.isLoading}<RepoSummaryCard repo_item={undefined} lite />{/if}
					</div>
				{/if}
			{/if}
			<div class="prose mb-2"><h4>Accounts</h4></div>
			{#each store.accounts as account (account.id)}
				<div
					class="flex items-center rounded-lg p-2"
					class:bg-base-100={store.logged_in_account?.id === account.id}
				>
					{#if store.logged_in_account?.id === account.id}
						<div class="flex grow">
							<button
								onclick={() => {
									accounts_manager.setActive(account.id);
								}}
							>
								<div>
									<UserHeader
										user={account.pubkey}
										link_to_profile={true}
										on_link_press={() => {
											is_open = false;
										}}
									/>
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
					}}>Add Another Account</button
				>

				<div class="grow"></div>
			</div>
			<ul class="flex w-full flex-col gap-1 py-2">
				<li class="w-full overflow-hidden rounded-md">
					<button
						class="hover:bg-base-200 active:bg-base-100 flex h-10 w-full items-center justify-end px-4 transition-colors"
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
						class="hover:bg-base-200 active:bg-base-100 flex h-10 w-full items-center justify-end px-4 transition-colors"
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
