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
	import { getDecodedToken, getEncodedToken, type Token } from '@cashu/cashu-ts';
	import { NostrWalletTokenKind } from '$lib/kinds';
	import type { Query } from 'applesauce-core';
	import { createWalletFilter, createWalletHistoryFilter } from '$lib/relay/filters/wallet';
	import { filter } from 'rxjs';
	import Container from './Container.svelte';
	import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
	import {
		getHistoryContent,
		isHistoryContentLocked,
		unlockHistoryContent
	} from 'applesauce-wallet/helpers/history';

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
	let history_query = new InMemoryQuery(Queries.WalletHistoryQuery, () => [pubkey] as const);
	let history = $derived(history_query.result);

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

	function lockedHistoryStream(pubkey: PubKeyString): Query<NostrEvent> {
		return {
			key: pubkey,
			run: (events) => {
				return events
					.filters(createWalletHistoryFilter(pubkey))
					.pipe(filter((e) => isHistoryContentLocked(e)));
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
		const subLockedHistory = memory_db_query_store
			.createQuery(lockedHistoryStream, pubkey)
			.subscribe((e) => {
				let active_account = accounts_manager.getActive();
				if (!auto_unlock || !e || !active_account || active_account.pubkey !== e.pubkey) return;
				unlockHistoryContent(e, active_account);
			});
		return () => {
			unsubWatchWallet();
			subLockedTokens?.unsubscribe?.();
			subLockedHistory?.unsubscribe?.();
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
					for (const t_event of history_query?.result ?? []) {
						await unlockHistoryContent(t_event, active_account);
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
	let receive_invalid_spent = $state(false);
	let receive_minting = $state(false);
	let receive_signing = $state(false);
	let receive_signed = $state(false);
	let receive_rejected_by_signer = $state(false);

	const received = async () => {
		let active_account = accounts_manager.getActive();
		if (!active_account || !wallet) {
			return;
		}
		let old_token: Token | undefined = undefined;
		try {
			old_token = getDecodedToken(receive_token);
		} catch {
			/* empty */
		}
		if (!old_token) {
			receive_invalid = true;
			return setTimeout(() => {
				receive_invalid = false;
			}, 2000);
		}
		receive_minting = true;
		// TODO persistantly store the old token just in case
		let c_mint = new CashuMint(old_token.mint);
		let c_wallet = new CashuWallet(c_mint);
		let token: Token | undefined = undefined;
		// TODO persistantly store the new token just in case
		try {
			let proofs = await c_wallet.receive(old_token);
			token = { mint: old_token.mint, proofs };
		} catch (e) {
			if (`${e}`.includes('already spent')) receive_invalid_spent = true;
			else console.log(e);
			receive_invalid = true;
		}
		if (!token)
			return setTimeout(() => {
				receive_invalid = false;
				receive_invalid_spent = false;
				// TODO: print error message?
			}, 2000);

		receive_minting = false;

		receive_signing = true;
		try {
			let funds_at_risk = false;
			let timeout_id = setTimeout(() => {
				if (receive_signing) {
					// TODO show an error now
				}
			}, 2000);

			let hub = new ActionHub(
				memory_db,
				new EventFactory({ signer: active_account }),
				async (label, event) => {
					receive_signed = true;
					query_centre.publishEvent(event);
				}
			);
			await hub.run(ReceiveToken, token);
		} catch {
			receive_token = getEncodedToken(token);
			// TODO funds at risks - save token
			console.log(`FUNDS AT RISK- SAVE THIS TOKEN: ${getEncodedToken(token)}`);
			receive_rejected_by_signer = true;
			const error =
				'funds at risk! the token has been swapped and you failed to sign the new token';
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
		disabled={receive_token.length < 10 || (receive_signing && !receive_rejected_by_signer)}
		class="btn btn-success"
		class:btn-error={receive_rejected_by_signer || receive_invalid}
	>
		{#if receive_invalid}
			{#if receive_invalid_spent}
				Token Already Spent
			{:else}
				Invalid Token
			{/if}
		{:else if receive_signing}
			{#if receive_rejected_by_signer}
				Funds At Risk - Rejected by Signer
			{:else if !receive_signed}
				Signing Receive
			{:else}
				Signing Swapped Token
			{/if}
		{:else}
			Receive Cashu
		{/if}
	</button>
	<div>
		<div>history</div>
		{#each (history ?? []).map(getHistoryContent).filter((h) => !!h) as h}
			{JSON.stringify(h)}
		{/each}
	</div>
{/if}
