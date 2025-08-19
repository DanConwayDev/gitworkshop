<script lang="ts">
	/* eslint-disable @typescript-eslint/no-unused-vars */
	import { InMemoryModel, inMemoryRelayTimeline } from '$lib/helpers.svelte';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import store from '$lib/store.svelte';
	import { isHttpUrl, type HttpUrl, type PubKeyString } from '$lib/types';
	import { decodeTokenFromEmojiString, encodeTokenToEmoji } from 'applesauce-wallet/helpers/tokens';
	import { ActionHub } from 'applesauce-actions';
	import { EventFactory } from 'applesauce-factory';
	import { onMount } from 'svelte';
	import accounts_manager from '$lib/accounts';
	import memory_db from '$lib/dbs/InMemoryRelay';
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
	import { createWalletFilter, createWalletHistoryFilter } from '$lib/relay/filters/wallet';
	import { filter } from 'rxjs';
	import { CashuMint, CashuWallet } from '@cashu/cashu-ts';
	import {
		getHistoryContent,
		isHistoryContentLocked,
		unlockHistoryContent,
		type HistoryContent
	} from 'applesauce-wallet/helpers/history';
	import FromNow from './FromNow.svelte';
	import ContainerCenterPage from './ContainerCenterPage.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		WalletBalanceModel,
		WalletHistoryModel,
		WalletModel,
		WalletTokensModel
	} from 'applesauce-wallet/models';
	import type { Model } from 'applesauce-core';

	let { pubkey }: { pubkey: PubKeyString } = $props();

	let t = $derived(query_centre.watchWallet(pubkey));
	let wallet_query = new InMemoryModel(WalletModel, () => [pubkey] as const);
	let wallet = $derived(wallet_query.result);

	let tok_q = inMemoryRelayTimeline([{ kinds: [NostrWalletTokenKind], authors: [pubkey] }]);
	let tokens_query = new InMemoryModel(WalletTokensModel, () => [pubkey] as const);
	let history_query = new InMemoryModel(WalletHistoryModel, () => [pubkey] as const);
	let history_events = $derived(history_query.result);
	let history: (HistoryContent & { created_at: number })[] = $derived(
		(history_events ?? [])
			.map((e) => {
				let c = getHistoryContent(e);
				if (!c) return undefined;
				return {
					created_at: e.created_at,
					...c
				};
			})
			.filter((h) => !!h)
	);

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
	let mint_balances_query = new InMemoryModel(WalletBalanceModel, () => [pubkey] as const);
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
		let mints = new SvelteSet<HttpUrl>();
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

	function lockedTokenStream(pubkey: PubKeyString): Model<NostrEvent> {
		return (events) => {
			return events
				.filters(createWalletFilter(pubkey))
				.pipe(filter((e) => isTokenContentLocked(e)));
		};
	}

	function lockedHistoryStream(pubkey: PubKeyString): Model<NostrEvent> {
		return (events) => {
			return events
				.filters(createWalletHistoryFilter(pubkey))
				.pipe(filter((e) => isHistoryContentLocked(e)));
		};
	}

	onMount(() => {
		setTimeout(() => {
			waited_1s = true;
		}, 1000);
		const unsubWatchWallet = query_centre.watchWallet(pubkey);
		// if auto_unlock start unlocking newly arrived tokens
		const subLockedTokens = memory_db.model(lockedTokenStream, pubkey).subscribe((e) => {
			let active_account = accounts_manager.getActive();
			if (!auto_unlock || !e || !active_account || active_account.pubkey !== e.pubkey) return;
			unlockTokenContent(e, active_account);
		});
		const subLockedHistory = memory_db.model(lockedHistoryStream, pubkey).subscribe((e) => {
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
		let hub = new ActionHub(memory_db, new EventFactory({ signer: active_account }), (event) => {
			create_wallet_signed = true;
			query_centre.publishEvent(event);
			create_wallet_signed = true;
		});
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
	let recieve_status = $state('');
	const received = async () => {
		let active_account = accounts_manager.getActive();
		if (!active_account || !wallet) {
			return;
		}
		recieve_status = '';
		let old_token: Token | undefined = undefined;
		try {
			old_token = getDecodedToken(receive_token);
		} catch {
			try {
				old_token = decodeTokenFromEmojiString(receive_token);
			} catch {
				/* empty */
			}
		}
		if (!old_token) {
			receive_invalid = true;
			if (receive_token.startsWith('cashu')) recieve_status = 'invalid cashu token string';
			else recieve_status = `${receive_token} doesn't look like a cashu token`;
			return setTimeout(() => {
				receive_invalid = false;
			}, 2000);
		}
		receive_minting = true;
		recieve_status = `swapping token with mint`;
		// TODO persistantly store the old token just in case
		let c_mint = new CashuMint(old_token.mint);
		let c_wallet = new CashuWallet(c_mint);
		let token: Token | undefined = undefined;
		// TODO persistantly store the new token just in case
		try {
			let proofs = await c_wallet.receive(old_token);
			token = { mint: old_token.mint, proofs };
		} catch (e) {
			if (`${e}`.includes('already spent')) {
				receive_invalid_spent = true;
				recieve_status = 'token already spent';
			} else {
				recieve_status = `error redeeming token: ${e}`;
				console.log(e);
			}
			receive_invalid = true;
		}
		if (!token)
			return setTimeout(() => {
				receive_invalid = false;
				receive_invalid_spent = false;
				// TODO: print error message?
			}, 2000);

		receive_minting = false;
		recieve_status = `signing new token event`;

		receive_signing = true;
		try {
			let funds_at_risk = false;
			let timeout_id = setTimeout(() => {
				if (receive_signing) {
					recieve_status = `${token.proofs.reduce((a, c) => a + c.amount, 0)} ${token.unit ?? 'sats'} at risk. sign event or recover this token:  ${encodeTokenToEmoji(token)}`;
					// TODO show an error now
				}
			}, 2000);

			let hub = new ActionHub(memory_db, new EventFactory({ signer: active_account }), (event) => {
				receive_signed = true;
				query_centre.publishEvent(event);
			});
			let fee =
				old_token.proofs.reduce((a, c) => a + c.amount, 0) -
				token.proofs.reduce((a, c) => a + c.amount, 0);

			await hub.run(ReceiveToken, token, [], fee);
			if (timeout_id) clearTimeout(timeout_id);
			recieve_status = `added to wallet`;
			receive_token = '';
			setTimeout(() => {
				recieve_status = '';
			}, 2000);
		} catch (e) {
			receive_token = getEncodedToken(token);
			recieve_status = `error: ${e}\n${token.proofs.reduce((a, c) => a + c.amount, 0)} ${token.unit ?? 'sats'} at risk. signing rejected. save this token:  ${encodeTokenToEmoji(token)}`;
			console.log(
				`${token.proofs.reduce((a, c) => a + c.amount, 0)} ${token.unit ?? 'sats'} AT RISK- SAVE THIS TOKEN: ${encodeTokenToEmoji(token)}`
			);
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
	<ContainerCenterPage>
		{#if !store.logged_in_account}
			<div>time to login</div>
		{:else if !waited_1s}
			loading
		{:else}
			<div>
				<div class="p-4">Cannot find Wallet</div>
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
	</ContainerCenterPage>
{:else if wallet.locked}
	<ContainerCenterPage>
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
	</ContainerCenterPage>
{:else}
	<div class="mb-4 max-w-3xl rounded-lg p-4">
		<div class="mb-4 rounded-lg p-4">
			<div class="mb-2 text-center text-xl font-bold">
				<span class="text-primary"
					>{#if masked}***{:else}{balance}{/if} sats</span
				>
			</div>
		</div>

		<div class="mb-4 rounded-lg p-4">
			<div class="flex flex-col gap-2">
				{#each mints as mint_url (mint_url)}
					<div class="bg-base-100 flex items-center justify-between rounded-md p-2">
						<div class="max-w-[200px] truncate text-sm">{mint_url}</div>
						<div class="badge badge-primary">
							{#if mint_balances?.[mint_url]}{#if masked}***{:else}{mint_balances[mint_url]}{/if}
							{:else}0{/if}
							sats
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="mb-6 flex flex-col gap-4">
			<div class="flex gap-2">
				<input
					disabled={receive_signing}
					type="text"
					placeholder="Paste cashu token here"
					class="input w-full"
					bind:value={receive_token}
					onpaste={() => setTimeout(received, 1)}
				/>
			</div>
		</div>
		<div>{recieve_status}</div>
		<div></div>

		<div class="rounded-lg p-4">
			<h3 class="mb-3 text-lg">Transaction History</h3>
			<div class="divide-base-300 divide-y">
				{#each history as h (h.created.join())}
					<div class="py-3">
						<div class="mb-2 flex items-center justify-between">
							<div class={h.direction === 'in' ? 'text-success' : 'text-warning'}>
								<span class="font-medium">{h.amount} sats</span>
							</div>
							{#if h.fee}<span class="text-neutral-content opacity-70">{h.fee} sat fee</span>{/if}
						</div>
						<div class="flex justify-between text-sm opacity-70">
							<div><FromNow unix_seconds={h.created_at} /></div>
							<div class="max-w-[200px] truncate">{h.mint}</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
