<script lang="ts">
	import { InMemoryQuery } from '$lib/helpers.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { type PubKeyString } from '$lib/types';
	import { Queries } from 'applesauce-wallet';
	import { ActionHub } from 'applesauce-actions';
	import { EventFactory } from 'applesauce-factory';
	import { onMount } from 'svelte';
	import accounts_manager from '$lib/accounts';
	import memory_db, { memory_db_query_store } from '$lib/dbs/InMemoryRelay';
	import { generateSecretKey } from 'nostr-tools/pure';
	import { CreateWallet } from 'applesauce-wallet/actions';
	import { unlockWallet } from 'applesauce-wallet/helpers';
	import { unlockTokenContent } from 'applesauce-wallet/helpers/tokens';

	let { pubkey }: { pubkey: PubKeyString } = $props();

	// let wallet = inMemoryCreateQuery(Queries.WalletQuery, pubkey);
	// let wallet = $state.raw<any | undefined>(undefined);
	// $effect(() => {
	// 	const sub = memory_db_query_store
	// 		.createQuery(Queries.WalletQuery, pubkey)
	// 		.subscribe((res: any | undefined) => {
	// 			wallet = res;
	// 		});
	// 	return () => {
	// 		sub.unsubscribe();
	// 	};
	// });
	let wallet_query = new InMemoryQuery(Queries.WalletQuery, () => [pubkey] as const);
	let wallet = $derived(wallet_query.result);

	let tokens_query = new InMemoryQuery(Queries.WalletTokensQuery, () => [pubkey] as const);
	// let tokens_detail_query = $derived(
	// 	tokens_query
	// 		? tokens_query.map((e) => {
	// 				try {
	// 					return getTokenContent(e);
	// 				} catch (err) {
	// 					return undefined;
	// 				}
	// 			})
	// 		: undefined
	// );
	// let mint_balances = inMemoryCreateQuery(Queries.WalletBalanceQuery, pubkey);
	// TODO add mints without tokens in
	// let mints = $derived.by(() => {
	// 	let mints = new Set<HttpUrl>();
	// 	if (!mint_balances || !wallet || wallet.locked) {
	// 		return mints;
	// 	}
	// 	wallet.mints.forEach((m) => {
	// 		if (isHttpUrl(m)) mints.add(m);
	// 	});
	// 	return mints;
	// });

	// const createWallet = () => {
	// 	factory;
	// 	memory_db;

	// 	query_centre.publishEvent();
	// };
	let auto_unlock = $state(false);
	let waited_1s = $state(false);
	onMount(() => {
		setTimeout(() => {
			waited_1s = true;
		}, 1000);
		const unsubWatchWallet = query_centre.watchWallet(pubkey);
		const subLockedTokens = memory_db_query_store
			.createQuery(Queries.WalletTokensQuery, pubkey)
			.subscribe((res) => {
				let active_account = accounts_manager.getActive();
				if (res && auto_unlock && active_account) {
					res.forEach((e) => unlockTokenContent(e, active_account));
				}
			});
		return () => {
			unsubWatchWallet();
			subLockedTokens.unsubscribe();
		};
	});

	let create_wallet_submitting = $state(false);
	let create_wallet_signed = $state(false);
	let create_wallet_rejected_by_signer = $state(false);

	const createWallet = async () => {
		let active_account = accounts_manager.getActive();
		if (!active_account) {
			return;
		}
		let hub = new ActionHub(
			memory_db,
			new EventFactory({ signer: active_account }),
			async (label, event) => {
				create_wallet_signed = true;
				query_centre.publishEvent(event);
				create_wallet_signed = true;
			}
		);
		try {
			create_wallet_submitting = true;
			await hub.run(CreateWallet, ['https://testnut.cashu.space'], generateSecretKey());
		} catch {
			create_wallet_rejected_by_signer = true;
			setTimeout(() => {
				create_wallet_rejected_by_signer = false;
				create_wallet_signed = false;
				create_wallet_submitting = false;
			}, 2000);
		}
	};

	let wallet_unlock_decypting = $state(false);
	let wallet_unlock_decrypted = $state(false);
	let wallet_unlock_rejected_by_signer = $state(false);

	const unlock = () => {
		let active_account = accounts_manager.getActive();
		if (!active_account || !wallet) {
			return;
		}
		wallet_unlock_decypting = true;
		try {
			Promise.all([
				unlockWallet(wallet.event, active_account),
				...(tokens_query.result
					? tokens_query.result.map((t_event) => unlockTokenContent(t_event, active_account))
					: [])
			]);
		} catch {
			wallet_unlock_rejected_by_signer = true;
			setTimeout(() => {
				wallet_unlock_rejected_by_signer = false;
				wallet_unlock_decypting = false;
				wallet_unlock_decrypted = false;
			}, 2000);
		}
	};
</script>

{#if !wallet}
	{#if !store.logged_in_account}
		<div>time to login</div>
	{:else if !waited_1s}
		loading
	{:else}
		<div>
			couldnt find wallet.
			<button onclick={createWallet} disabled={create_wallet_submitting} class="btn btn-success">
				{#if create_wallet_submitting}
					{#if create_wallet_rejected_by_signer}
						Rejected by Signer
					{:else if !create_wallet_signed}
						Signing
					{:else}
						Sending
					{/if}
				{:else}
					Create Wallet
				{/if}
			</button>
		</div>
	{/if}
{:else if wallet.locked}
	<button onclick={unlock} disabled={wallet_unlock_decypting} class="btn btn-success">
		{#if wallet_unlock_decypting}
			{#if wallet_unlock_rejected_by_signer}
				Rejected by Signer
			{:else if !wallet_unlock_decrypted}
				Decrypting Wallet
			{:else}
				Unlocked...
			{/if}
		{:else}
			Unlock Wallet
		{/if}
	</button>
{:else}
	wallet unlocked
	{JSON.stringify(wallet.mints)}
{/if}
