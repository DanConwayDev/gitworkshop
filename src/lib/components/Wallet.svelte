<script lang="ts">
	import { InMemoryQuery, inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isHttpUrl, type HttpUrl, type PubKeyString } from '$lib/types';
	import { Queries } from 'applesauce-wallet';
	import { ActionHub } from 'applesauce-actions';
	import { EventFactory } from 'applesauce-factory';
	import { onMount } from 'svelte';
	import accounts_manager from '$lib/accounts';
	import memory_db, { memory_db_query_store } from '$lib/dbs/InMemoryRelay';
	import { generateSecretKey } from 'nostr-tools/pure';
	import type { NostrEvent } from 'nostr-tools';
	import { CreateWallet } from 'applesauce-wallet/actions';
	import { ReceiveToken } from 'applesauce-wallet/actions/tokens';
	import { unlockWallet } from 'applesauce-wallet/helpers';
	import {
		unlockTokenContent,
		isTokenContentLocked,
		getTokenContent
	} from 'applesauce-wallet/helpers/tokens';
	import { getDecodedToken, type Token } from '@cashu/cashu-ts';
	import { NostrWalletTokenKind } from '$lib/kinds';
	import type { Query } from 'applesauce-core';
	import { createWalletFilter } from '$lib/relay/filters/wallet';
	import { filter } from 'rxjs';
	import Container from './Container.svelte';
	import { CashuWalletEvent } from '$lib/kind_labels';

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

	let tok_q = inMemoryRelayTimeline([{ kinds: [NostrWalletTokenKind], authors: [pubkey] }]);
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
	let mint_balances_query = new InMemoryQuery(Queries.WalletBalanceQuery, () => [pubkey] as const);
	let mint_balances = $derived(mint_balances_query.result);
	let balance = $derived.by(() => {
		try {
			return tokens_query.result
				?.flatMap((e) => getTokenContent(e)?.proofs)
				.reduce((a, p) => (p ? p.amount : 0) + a, 0);
		} catch {
			return undefined;
		}
	});
	// TODO add mints without tokens in
	let mints = $derived.by(() => {
		let mints = new Set<HttpUrl>();
		if (!mint_balances || !wallet || wallet.locked) {
			return mints;
		}
		wallet.mints.forEach((m) => {
			if (isHttpUrl(m)) mints.add(m);
		});
		return mints;
	});

	// const createWallet = () => {
	// 	factory;
	// 	memory_db;

	// 	query_centre.publishEvent();
	// };
	let auto_unlock = $state(false);
	let waited_1s = $state(false);

	let masked = $state(false);

	function lockedTokenStream(pubkey: PubKeyString): Query<NostrEvent> {
		return {
			key: pubkey,
			run: (events) => {
				return events
					.filters(createWalletFilter(pubkey))
					.pipe(filter((e) => isTokenContentLocked(e)));
			}
		};
	}

	onMount(() => {
		setTimeout(() => {
			waited_1s = true;
		}, 1000);
		const unsubWatchWallet = query_centre.watchWallet(pubkey);
		// if auto_unlock start unlocking newly arrived tokens
		const subLockedTokens = memory_db_query_store
			.createQuery(lockedTokenStream, pubkey)
			.subscribe((e) => {
				let active_account = accounts_manager.getActive();
				if (!auto_unlock || !e || !active_account || active_account.pubkey !== e.pubkey) return;
				unlockTokenContent(e, active_account);
			});
		return () => {
			unsubWatchWallet();
			subLockedTokens?.unsubscribe?.();
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
				(async () => {
					for (const t_event of tokens_query?.result ?? []) {
						await unlockTokenContent(t_event, active_account);
					}
				})()
			]);
			auto_unlock = true;
		} catch {
			wallet_unlock_rejected_by_signer = true;
			setTimeout(() => {
				wallet_unlock_rejected_by_signer = false;
				wallet_unlock_decypting = false;
				wallet_unlock_decrypted = false;
			}, 2000);
		}
	};

	let receive_token = $state('');
	let receive_invalid = $state(false);
	let receive_signing = $state(false);
	let receive_signed = $state(false);
	let receive_rejected_by_signer = $state(false);

	const received = async () => {
		let active_account = accounts_manager.getActive();
		if (!active_account || !wallet) {
			return;
		}
		let token: Token | undefined = undefined;
		try {
			token = getDecodedToken(receive_token);
			cashu;
		} catch {
			/* empty */
		}
		if (!token) {
			receive_invalid = true;
			return setTimeout(() => {
				receive_invalid = false;
			}, 2000);
		}
		receive_signing = true;
		try {
			let hub = new ActionHub(
				memory_db,
				new EventFactory({ signer: active_account }),
				async (label, event) => {
					receive_signed = true;
					query_centre.publishEvent(event);
				}
			);
			receive_signed = true;
			await hub.run(ReceiveToken, token);
		} catch {
			receive_rejected_by_signer = true;
		}
		setTimeout(() => {
			if (!receive_rejected_by_signer) receive_token = '';
			receive_rejected_by_signer = false;
			receive_signed = false;
			receive_signing = false;
			receive_token = '';
		}, 2000);
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
	<Container>
		<div class="text-xl">
			{#if masked}***{:else}{balance}{/if} sats
		</div>
	</Container>
	<Container>
		{#each mints as mint_url}
			{mint_url}
			{#if mint_balances?.[mint_url]}{#if masked}***{:else}{mint_balances[mint_url]}{/if}
			{:else}0{/if}
			sats
		{/each}
	</Container>

	<input
		disabled={receive_signing}
		type="text"
		placeholder="cashu token"
		class="input input-sm input-bordered w-full max-w-xs"
		bind:value={receive_token}
	/>
	<button
		onclick={received}
		disabled={receive_token.length < 10 || receive_signing}
		class="btn btn-success"
		class:btn-error={receive_rejected_by_signer || receive_invalid}
	>
		{#if receive_invalid}
			Invalid Token
		{:else if receive_signing}
			{#if receive_rejected_by_signer}
				Rejected by Signer
			{:else if !receive_signed}
				Signing Receive
			{:else}
				Received...
			{/if}
		{:else}
			Receive Cashu
		{/if}
	</button>
{/if}
