<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import {
		NostrConnectSigner,
		AmberClipboardSigner,
		ExtensionSigner,
		SimpleSigner
	} from 'applesauce-signers';
	import {
		ExtensionAccount,
		SimpleAccount,
		AmberClipboardAccount
	} from 'applesauce-accounts/accounts';
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	import QRCode from 'svelte-qrcode';
	import { icons_misc } from '$lib/icons';
	import CopyField from './CopyField.svelte';
	import { nip19 } from 'nostr-tools';
	import { isWebSocketUrl, type WebSocketUrl } from '$lib/types';
	import accounts_manager from '$lib/accounts';
	import { isHexKey } from 'applesauce-core/helpers';
	import { NostrConnectAccount } from 'applesauce-accounts/accounts/nostr-connect-account';
	let { done, onNavigate }: { done: () => void; onNavigate?: () => void } = $props();

	let nip07_plugin: boolean | undefined = $state('nostr' in window);

	let nip07 = $state(false);
	let private_key = $state(false);
	let private_key_invalid = $state(false);
	let amber_feature_toggle = $state(true);
	let amber = $state(false);
	let nostr_connect = $state(false);
	let bunker_url = $state(false);
	let signup_feature_toggle = $state(false);
	let success = $state(false);
	let nostr_connect_url_copied = $state(false);

	let nostr_connect_relay_inputs = $state<string[]>(['', '']);
	const getRelayUrls = (): WebSocketUrl[] => {
		let relays: WebSocketUrl[] = [];
		nostr_connect_relay_inputs.forEach((r) => {
			const trimmed = r.trim();
			if (trimmed && isWebSocketUrl(trimmed)) relays.push(trimmed);
		});
		return relays;
	};

	// Auto-add new input when last input has valid URL
	$effect(() => {
		const lastInput = nostr_connect_relay_inputs[nostr_connect_relay_inputs.length - 1];
		if (lastInput && lastInput.trim() && isWebSocketUrl(lastInput.trim())) {
			// Add new empty input if last one is valid
			if (nostr_connect_relay_inputs[nostr_connect_relay_inputs.length - 1] !== '') {
				nostr_connect_relay_inputs = [...nostr_connect_relay_inputs, ''];
			}
		}
	});
	let nostr_connect_url = $state('');
	let nostr_connect_listening = $state(false);
	let bunker_url_input = $state('');
	let bunker_url_invalid = $state(false);
	let bunker_url_error_message = $state('');
	let bunker_url_connecting = $state(false);

	let nostr_connect_signer: NostrConnectSigner | undefined = undefined;

	async function listenForNostrConnect() {
		let relays = getRelayUrls();
		// Default to relay.nsec.app if no relays specified
		if (relays.length === 0) {
			relays.push('wss://relay.nsec.app');
		}

		nostr_connect_listening = true;
		nostr_connect_signer?.close();

		try {
			nostr_connect_signer = new NostrConnectSigner({ relays });
			nostr_connect_url = nostr_connect_signer.getNostrConnectURI({
				name: 'gitworkshop.dev'
				// image: 'https://gitworkshop.dev/icons/icon.svg'
			});

			await nostr_connect_signer.waitForSigner();
			let pubkey = await nostr_connect_signer.getPublicKey();
			const account = new NostrConnectAccount(pubkey, nostr_connect_signer);
			account.metadata = { connectionType: 'nostr-connect' };
			accounts_manager.addAccount(account);
			accounts_manager.setActive(account);
			complete();
		} catch (error) {
			console.error('Nostr Connect error:', error);
			// Don't set listening to false - keep showing status
		}
	}

	function removeRelayInput(index: number) {
		nostr_connect_relay_inputs = nostr_connect_relay_inputs.filter((_, i) => i !== index);
		if (nostr_connect_relay_inputs.length === 0) {
			nostr_connect_relay_inputs = ['', ''];
		}
		listenForNostrConnect();
	}

	async function connectWithBunkerUrl(bunkerUrl: string) {
		try {
			bunker_url_invalid = false;
			bunker_url_error_message = '';
			bunker_url_connecting = true;
			nostr_connect_signer?.close();

			// Create signer from bunker URL
			nostr_connect_signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);

			// Get the public key
			let pubkey = await nostr_connect_signer.getPublicKey();

			// Create and add account
			const account = new NostrConnectAccount(pubkey, nostr_connect_signer);
			account.metadata = { connectionType: 'bunker' };
			accounts_manager.addAccount(account);
			accounts_manager.setActive(account);
			complete();
		} catch (error) {
			console.error('Failed to connect with bunker URL:', error);
			bunker_url_invalid = true;

			// Provide more specific error messages
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.toLowerCase().includes('unauthorized') ||
				errorMessage.toLowerCase().includes('auth')
			) {
				bunker_url_error_message = 'Authorization failed. Please check your bunker credentials.';
			} else if (
				errorMessage.toLowerCase().includes('timeout') ||
				errorMessage.toLowerCase().includes('timed out')
			) {
				bunker_url_error_message =
					'Connection timed out. Please check the bunker URL and try again.';
			} else if (
				errorMessage.toLowerCase().includes('relay') ||
				errorMessage.toLowerCase().includes('connect')
			) {
				bunker_url_error_message = 'Failed to connect to relay. Please check your connection.';
			} else if (!bunkerUrl.startsWith('bunker://')) {
				bunker_url_error_message = 'Invalid bunker URL format. Expected format: bunker://...';
			} else {
				bunker_url_error_message = `Connection failed: ${errorMessage}`;
			}
		} finally {
			bunker_url_connecting = false;
		}
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
					class="fill-success mx-auto mb-3 h-16 w-16"
				>
					{#each icons_misc.complete as d (d)}
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
				class="input input-sm mt-5 w-full"
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
		{:else if bunker_url}
			<div class="prose"><h4 class="text-center">Bunker URL</h4></div>
			<!-- eslint-disable-next-line svelte/valid-compile -->
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				type="text"
				placeholder="bunker://"
				class="input input-sm mt-5 w-full"
				class:border-error={bunker_url_invalid}
				class:focus:border-error={bunker_url_invalid}
				disabled={bunker_url_connecting}
				bind:value={bunker_url_input}
				oninput={() => {
					// Clear error when user starts typing
					if (bunker_url_invalid) {
						bunker_url_invalid = false;
						bunker_url_error_message = '';
					}
				}}
				onpaste={async (event) => {
					const s = event.clipboardData?.getData('text');
					if (!s) {
						bunker_url_invalid = true;
						bunker_url_error_message = 'No text found in clipboard.';
						return;
					}
					bunker_url_input = s;
					if (s.startsWith('bunker://')) {
						await connectWithBunkerUrl(s);
					} else {
						bunker_url_invalid = true;
						bunker_url_error_message = 'Invalid bunker URL format. Expected format: bunker://...';
					}
				}}
			/>
			{#if bunker_url_connecting}
				<div class="mt-2">
					<span class="text-info flex items-center gap-2 text-sm">
						<span class="loading loading-spinner loading-xs"></span>
						Connecting to bunker...
					</span>
				</div>
			{:else if bunker_url_invalid && bunker_url_error_message}
				<div class="mt-2">
					<span class="text-error block text-sm break-all">{bunker_url_error_message}</span>
				</div>
			{/if}
			<div class="modal-action">
				<button
					class="btn btn-sm"
					onclick={() => {
						bunker_url = false;
						bunker_url_invalid = false;
						bunker_url_error_message = '';
						bunker_url_input = '';
					}}>Back</button
				>
			</div>
		{:else if nostr_connect}
			<div class="prose"><h4 class="text-center">Nostr Connect</h4></div>
			<div class="mt-3 flex w-full justify-center">
				<a href={nostr_connect_url} target="_blank" rel="noopener noreferrer" class="block">
					<div class="bg-white pt-4 pl-4 transition-opacity hover:opacity-80">
						<QRCode value={nostr_connect_url} size={512} />
					</div>
				</a>
			</div>
			<div class="mt-3 flex w-full items-center gap-2">
				<a
					href={nostr_connect_url}
					target="_blank"
					rel="noopener noreferrer"
					class="link link-primary flex-1 truncate text-sm"
					title={nostr_connect_url}
				>
					{nostr_connect_url.length > 105
						? `${nostr_connect_url.substring(0, 100)}...${nostr_connect_url.substring(nostr_connect_url.length - 5)}`
						: nostr_connect_url}
				</a>
				<button
					class="btn btn-sm btn-square"
					class:btn-success={nostr_connect_url_copied}
					onclick={async () => {
						try {
							await navigator.clipboard.writeText(nostr_connect_url);
							nostr_connect_url_copied = true;
							setTimeout(() => {
								nostr_connect_url_copied = false;
							}, 1000);
						} catch {
							/* empty */
						}
					}}
					title="Copy to clipboard"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="h-4 w-4"
						class:fill-success-content={nostr_connect_url_copied}
						class:fill-base-content={!nostr_connect_url_copied}
					>
						{#each icons_misc.copy as d (d)}
							<path {d} />
						{/each}
					</svg>
				</button>
			</div>
			<fieldset class="fieldset w-full">
				<label class="label" for="nostr-connect-relay-0">
					<span>Connection Relays</span>
				</label>
				<div class="flex flex-col gap-2">
					{#each nostr_connect_relay_inputs as _relay, index (index)}
						<div class="flex gap-2">
							<input
								id="nostr-connect-relay-{index}"
								type="text"
								placeholder={index === 0 ? 'wss://relay.nsec.app' : 'wss://...'}
								class="input input-sm w-full"
								bind:value={nostr_connect_relay_inputs[index]}
								oninput={(e) => {
									const value = (e.target as HTMLInputElement).value.trim();
									// Only update if it's a complete valid URL
									if (value && isWebSocketUrl(value)) {
										listenForNostrConnect();
									}
								}}
								onpaste={() => {
									setTimeout(() => listenForNostrConnect(), 100);
								}}
							/>
							{#if index > 0 || (nostr_connect_relay_inputs.length > 1 && nostr_connect_relay_inputs[index].trim())}
								<button
									class="btn btn-sm btn-square btn-ghost"
									onclick={() => removeRelayInput(index)}
									aria-label="Remove relay"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 16 16"
										fill="currentColor"
										class="h-4 w-4"
									>
										<path
											d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z"
										/>
									</svg>
								</button>
							{/if}
						</div>
					{/each}
				</div>
				{#if nostr_connect_listening}
					<div class="label">
						<span class="text-info flex items-center gap-2 text-sm">
							<span class="loading loading-spinner loading-xs"></span>
							Listening for signer...
						</span>
					</div>
				{/if}
			</fieldset>

			<div class="modal-action">
				<button
					class="btn btn-sm"
					onclick={() => {
						nostr_connect = false;
						nostr_connect_listening = false;
						nostr_connect_relay_inputs = ['', ''];
						nostr_connect_signer?.close();
					}}>Back</button
				>
			</div>
		{:else}
			<div class="prose mb-3"><h4 class="text-center">Sign in</h4></div>
			{#if amber_feature_toggle && AmberClipboardSigner.SUPPORTED}
				<div class="join join-horizontal flex w-full">
					<button
						class="btn btn-primary join-item grow"
						onclick={async () => {
							try {
								amber = true;
								const signer = new AmberClipboardSigner();
								const pubkey = await signer.getPublicKey();
								const account = new AmberClipboardAccount(pubkey, signer);
								account.metadata = { connectionType: 'amber' };
								accounts_manager.addAccount(account);
								accounts_manager.setActive(account);
								complete();
							} catch (error) {
								console.error('Amber login error:', error);
								amber = false;
							}
						}}>Use Amber</button
					>
					<a
						href={resolve(
							'/naddr1qvzqqqrhnypzqateqake4lc2fn77lflzq30jfpk8uhvtccalc66989er8cdmljceqy88wumn8ghj7mn0wvhxcmmv9uqq2stdvfjhyfhlzef'
						)}
						class="bl-1 btn btn-primary join-item items-center opacity-80"
						onclick={() => {
							done();
							onNavigate?.();
						}}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-4 w-4 items-center"
						>
							{#each icons_misc.question as d (d)}
								<path {d} />
							{/each}
						</svg>
					</a>
				</div>
			{/if}
			<div class="my-3 flex flex-col gap-3 sm:grid sm:grid-cols-2">
				{#if nip07_plugin}
					<button
						class="btn btn-sm"
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
						}}>Browser Extension</button
					>
				{/if}
				<button
					class="btn btn-sm"
					onclick={() => {
						private_key = true;
					}}>Private Key</button
				>
				<button
					class="btn btn-sm"
					onclick={() => {
						bunker_url = true;
					}}>Bunker URL</button
				>
				<button
					class="btn btn-sm"
					onclick={() => {
						nostr_connect = true;
						listenForNostrConnect();
					}}>Nostr Connect</button
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
