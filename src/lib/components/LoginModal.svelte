<script lang="ts">
	import { onMount } from 'svelte';
	import {
		NostrConnectSigner,
		AmberClipboardSigner,
		ExtensionSigner,
		SimpleSigner
	} from 'applesauce-signers';
	import { ExtensionAccount, SimpleAccount } from 'applesauce-accounts/accounts';
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	import QRCode from 'svelte-qrcode';
	import { icons_misc } from '$lib/icons';
	import CopyField from './CopyField.svelte';
	import { nip19 } from 'nostr-tools';
	import { isWebSocketUrl, type WebSocketUrl } from '$lib/types';
	import accounts_manager, { nostr_connect_pools } from '$lib/accounts';
	import { isHexKey } from 'applesauce-core/helpers';
	import { NostrConnectAccount } from 'applesauce-accounts/accounts/nostr-connect-account';
	import { SimplePool } from 'nostr-tools/pool';
	let { done }: { done: () => void } = $props();

	let nip07_plugin: boolean | undefined = $state('nostr' in window);

	let nip07 = $state(false);
	let private_key = $state(false);
	let private_key_invalid = $state(false);
	let amber_feature_toggle = $state(false);
	let amber = $state(false);
	let nostr_connect = $state(false);
	let signup_feature_toggle = $state(false);
	let success = $state(false);

	let nostr_connect_relay_urls = $state('');
	const getRelayUrls = (): WebSocketUrl[] => {
		let relays: WebSocketUrl[] = [];
		nostr_connect_relay_urls.split(' ').forEach((r) => {
			if (isWebSocketUrl(r)) relays.push(r);
		});
		return relays;
	};
	let nostr_connect_relay_invalid = $derived(
		nostr_connect_relay_urls.length > 0 && getRelayUrls().length === 0
	);
	let nostr_connect_simple_signer = new SimpleSigner();
	let nostr_connect_url = $state('');
	let bunker_url_invalid = $state(false);

	let nostr_connect_signer: NostrConnectSigner | undefined = undefined;

	async function listenForNostrConnect() {
		let relays = getRelayUrls();
		if (relays.length === 0 && nostr_connect_relay_urls.length === 0) {
			relays.push('wss://relay.nsec.app');
		}
		try {
			nostr_connect_signer?.close();
			// pool?.close(Array.from(pool.listConnectionStatus().keys()));
			nostr_connect_signer = new NostrConnectSigner({
				async onSubOpen(filters, relays, onEvent) {
					nostr_connect_pools?.subscribeMany(relays, filters, {
						onevent: (event) => {
							onEvent(event);
						}
					});
				},
				async onSubClose() {},
				async onPublishEvent(event, relays) {
					nostr_connect_pools?.publish(relays, event);
				},
				relays
			});
			nostr_connect_url = nostr_connect_signer.getNostrConnectURI({
				name: 'gitworkshop.dev'
				// image: 'https://gitworkshop.dev/icons/icon.svg'
			});

			await nostr_connect_signer.waitForSigner();
			let pubkey = await nostr_connect_signer.getPublicKey();
			const account = new NostrConnectAccount(pubkey, nostr_connect_signer);
			accounts_manager.addAccount(account);
			accounts_manager.setActive(account);
			complete();
		} catch {}
	}

	const complete = () => {
		success = true;
		setTimeout(done, 1000);
	};
	onMount(() => {
		setTimeout(() => {
			nip07_plugin = 'nostr' in window;
		}, 1000);

		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') done();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('modal-open') && !target.classList.contains('modal-box'))
				done();
		});
	});

	function hexToUint8Array(hex: string) {
		const length = hex.length / 2;
		const uint8Array = new Uint8Array(length);
		for (let i = 0; i < length; i++) {
			uint8Array[i] = parseInt(hex.substr(i * 2, 2), 16);
		}
		return uint8Array;
	}
</script>

{#snippet waiting(text: string, back: () => void)}
	<div class="py-9 text-center">
		<span class="loading loading-spinner loading-lg mb-4"></span>
		<div>{text}</div>
	</div>
	<div class="modal-action">
		<button
			class="btn btn-sm"
			onclick={() => {
				back();
			}}>Back</button
		>
	</div>
{/snippet}

<dialog class="modal modal-open">
	<div class="modal-box max-w-lg text-wrap">
		{#if success}
			<div class="py-9 text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="mx-auto mb-3 h-16 w-16 fill-success"
				>
					{#each icons_misc.complete as d}
						<path {d} />
					{/each}
				</svg>
				<div>Sign in Successful</div>
			</div>
		{:else if nip07}
			{@render waiting('waiting for your approval in the browser extension...', async () => {
				nip07 = false;
			})}
		{:else if amber}
			{@render waiting('waiting Amber...', async () => {
				amber = false;
			})}
		{:else if private_key}
			<div class="prose"><h4 class="text-center">Private Key</h4></div>
			<!-- eslint-disable-next-line svelte/valid-compile -->
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				type="text"
				placeholder="nsec1..."
				onpaste={async (event) => {
					const s = event.clipboardData?.getData('text');
					try {
						let hex;
						if (s && isHexKey(s)) {
							hex = hexToUint8Array(s);
						} else {
							let r = nip19.decode(s as `nsec1${string}`);
							if (r.type === 'nsec') {
								hex = r.data;
							}
						}
						const signer = new SimpleSigner(hex);
						const pubkey = await signer.getPublicKey();
						const account = new SimpleAccount(pubkey, signer);
						accounts_manager.addAccount(account);
						accounts_manager.setActive(account);
						complete();
					} catch {
						private_key_invalid = true;
						/* empty */
					}
				}}
				class="input input-sm input-bordered mt-5 w-full"
				class:border-error={private_key_invalid}
				class:focus:border-error={private_key_invalid}
			/>
			<div class="modal-action">
				<button
					class="btn btn-sm"
					onclick={() => {
						private_key = false;
					}}>Back</button
				>
			</div>
		{:else if nostr_connect}
			<div class="prose"><h4 class="text-center">Nostr Connect</h4></div>
			<div class="mt-3 w-full"><QRCode value={nostr_connect_url} size={512} /></div>
			<div class="w-50">
				<CopyField content={nostr_connect_url} no_border={true} truncate={[100, 105]} />
			</div>
			<label class="form-control w-full">
				<div class="label">
					<span class="label-text">Connection Relay</span>
				</div>
				<input
					type="text"
					placeholder="wss://relay.nsec.app"
					class="input input-sm input-bordered w-full"
					class:border-error={nostr_connect_relay_invalid}
					class:focus:border-error={nostr_connect_relay_invalid}
					bind:value={nostr_connect_relay_urls}
					onpaste={() => {
						listenForNostrConnect();
					}}
					onfocusout={() => {
						listenForNostrConnect();
					}}
				/>
				{#if nostr_connect_relay_invalid}
					<div class="label">
						<span class="label-text-alt text-error">invalid relay url</span>
						<span class="label-text-alt text-error">using wss://relay.nsec.app</span>
					</div>
				{/if}
			</label>
			<!-- <div class="divider">OR</div>
			<input
				type="text"
				placeholder="bunker://"
				class="input input-sm input-bordered w-full"
				class:border-error={bunker_url_invalid}
				class:focus:border-error={bunker_url_invalid}
				onpaste={(event) => {
					const s = event.clipboardData?.getData('text');
					try {
						if (!s) bunker_url_invalid = true;
						// let client = NostrConnectSigner.fromBunkerURI(
						// 	s
						// 	// TODO listen on relay
						// );
					} catch {
						bunker_url_invalid = true;
					}
					// TODO is valid
				}}
			/> -->

			<div class="modal-action">
				<button
					class="btn btn-sm"
					onclick={() => {
						nostr_connect = false;
					}}>Back</button
				>
			</div>
		{:else}
			<div class="prose mb-3"><h4 class="text-center">Sign in</h4></div>
			{#if amber_feature_toggle && AmberClipboardSigner.SUPPORTED}
				<div class="join join-horizontal flex w-full">
					<button
						class="btn btn-primary join-item flex-grow"
						onclick={async () => {
							try {
								amber = true;
								// const signer = new AmberClipboardSigner();
								// const pubkey = await signer.getPublicKey();
								// const account = new AmberClipboardAccount(pubkey, signer);
								// accounts_manager.addAccount(account);
								// accounts_manager.setActive(account);
								// complete();
							} catch {
								amber = false;
							}
						}}>Use Amber</button
					>
					<a
						href="/naddr1qvzqqqrhnypzqateqake4lc2fn77lflzq30jfpk8uhvtccalc66989er8cdmljceqy88wumn8ghj7mn0wvhxcmmv9uqq2stdvfjhyfhlzef"
						class="bl-1 btn btn-primary join-item items-center opacity-80"
						onclick={() => {
							done();
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-4 w-4 items-center"
						>
							{#each icons_misc.question as d}
								<path {d} />
							{/each}
						</svg>
					</a>
				</div>
			{/if}
			<div class="my-3 flex space-x-1">
				{#if nip07_plugin}
					<button
						class="btn flex-grow"
						onclick={async () => {
							nip07 = true;
							let pubkey = await (
								window as unknown as { nostr: { getPublicKey: () => Promise<string> } }
							).nostr.getPublicKey();
							const signer = new ExtensionSigner();
							const account = new ExtensionAccount(pubkey, signer);
							accounts_manager.addAccount(account);
							accounts_manager.setActive(account);
							complete();
						}}>Browser <br /> Extension</button
					>
					<div class="divider divider-horizontal"></div>
				{/if}
				<button
					class="btn flex-grow"
					onclick={() => {
						nostr_connect = true;
						listenForNostrConnect();
					}}>Nostr Connect</button
				>
				<div class="divider divider-horizontal"></div>
				<button
					class="btn flex-grow"
					onclick={() => {
						private_key = true;
					}}>Private Key</button
				>
			</div>
			{#if signup_feature_toggle}
				<div class="divider">OR</div>
				<button class="btn w-full">Sign up</button>
			{/if}
			<div class="modal-action">
				<button class="btn btn-sm" onclick={done}>Close</button>
			</div>
		{/if}
	</div>
</dialog>
