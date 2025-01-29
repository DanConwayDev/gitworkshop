<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AmberClipboardSigner,
		ExtensionSigner,
		NostrConnectSigner,
		SimpleSigner
	} from 'applesauce-signer';
	import {
		AmberClipboardAccount,
		ExtensionAccount,
		SimpleAccount
	} from 'applesauce-accounts/accounts';
	import QRCode from 'svelte-qrcode';
	import { icons_misc } from '$lib/icons';
	import CopyField from './CopyField.svelte';
	import { nip19 } from 'nostr-tools';
	import { isWebSocketUrl } from '$lib/types';
	import accounts_manager from '$lib/accounts';
	import { isHexKey } from 'applesauce-core/helpers';
	let { done }: { done: () => void } = $props();

	let nip07_plugin: boolean | undefined = $state('nostr' in window);

	let nip07 = $state(false);
	let private_key = $state(false);
	let private_key_invalid = $state(false);
	let amber = $state(false);
	let nostr_connect = $state(false);
	let bunker_url_invalid = $state(false);
	let connection_relay_invalid = $state(false);
	let success = $state(false);
	const complete = () => {
		success = true;
		setTimeout(done, 1000);
	};
	onMount(() => {
		setTimeout(() => {
			nip07_plugin = 'nostr' in window;
		}, 1000);
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

<div class="modal modal-open">
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
			<div class="mt-3 w-full"><QRCode value="nostrconnect://[inster]" size={512} /></div>
			<CopyField content={'nostrconnect://bla'} no_border={true} />
			<label class="form-control w-full">
				<div class="label">
					<span class="label-text">Connection Relay</span>
				</div>
				<input
					type="text"
					placeholder="wss://relay.nsec.app"
					class="input input-sm input-bordered w-full"
					class:border-error={connection_relay_invalid}
					class:focus:border-error={connection_relay_invalid}
					onpaste={(event) => {
						connection_relay_invalid = false;
						const s = event.clipboardData?.getData('text');
						try {
							if (!s || !isWebSocketUrl(s)) {
								throw 'not a valid websocket url';
							}
							// TODO: udpate QRcode
							// TODO: start listening to relay
						} catch {
							connection_relay_invalid = true;
						}
					}}
					onfocusout={() => {
						// el.currentTarget.
					}}
				/>
			</label>
			<div class="divider">OR</div>
			<input
				type="text"
				placeholder="bunker://"
				class="input input-sm input-bordered w-full"
				class:border-error={bunker_url_invalid}
				class:focus:border-error={bunker_url_invalid}
				onpaste={(event) => {
					const s = event.clipboardData?.getData('text');
					try {
						let client = NostrConnectSigner.fromBunkerURI(
							s
							// TODO listen on relay
						);
					} catch {
						bunker_url_invalid = true;
					}
					// TODO is valid
				}}
			/>

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
			{#if AmberClipboardSigner.SUPPORTED}
				<div class="join join-horizontal flex w-full">
					<button
						class="btn btn-primary join-item flex-grow"
						onclick={async () => {
							try {
								amber = true;
								const signer = new AmberClipboardSigner();
								const pubkey = await signer.getPublicKey();
								const account = new AmberClipboardAccount(pubkey);
								accounts_manager.addAccount(account);
								accounts_manager.setActive(account);
								complete();
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
								window as unknown as { nostr: { getPublicKey: () => Promise<PubKeyString> } }
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
			<div class="divider">OR</div>
			<button class="btn w-full">Sign up</button>
			<div class="modal-action">
				<button class="btn btn-sm" onclick={done}>Close</button>
			</div>
		{/if}
	</div>
</div>
