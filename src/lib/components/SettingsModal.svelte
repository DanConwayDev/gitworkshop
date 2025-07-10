<script lang="ts">
	import { onMount } from 'svelte';
	import { clearLocalRelayDb } from '$lib/dbs/LocalRelayDb';
	import db from '$lib/dbs/LocalDb';
	import store from '$lib/store.svelte';
	let { done }: { done: () => void } = $props();

	onMount(() => {
		window.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') done();
		});
		window.addEventListener('click', (event) => {
			const target = event.target as HTMLElement;
			if (target.classList.contains('modal-open') && !target.classList.contains('modal-box'))
				done();
		});
	});

	let clearing = $state(false);

	async function clearDatabases() {
		clearing = true;
		await clearLocalRelayDb();
		await db.delete();
		clearing = false;
		location.reload();
	}
</script>

<dialog class="modal modal-open">
	<div class="modal-box max-w-lg overflow-hidden text-wrap">
		<div class="prose mb-5"><h3>Settings</h3></div>

		<div>
			<div class="mb-2 font-bold">URL format:</div>
			<label class="mb-2 flex items-start">
				<input
					class="radio radio-sm mr-2"
					type="radio"
					name="url-pref"
					value={null}
					bind:group={store.stored_url_pref}
				/>
				<div class="flex flex-col break-all">
					<span>
						<span class="font-bold">default</span>
						<span class="ml-2 text-gray-500"> nip05</span>
					</span>
				</div>
			</label>
			<div class="flex flex-col">
				<label class="mb-2 flex items-start">
					<input
						class="radio radio-sm mr-2"
						type="radio"
						name="url-pref"
						value="nip05"
						bind:group={store.stored_url_pref}
					/>
					<div class="flex flex-col break-all">
						<span>
							<span class="font-bold">&lt;nip05&gt;/&lt;identifier&gt;</span>
							<span class="text-gray-500"
								>only if nip05 can be verified. eg. gitworkshop.dev/vitorpamplona.com/amethyst</span
							>
						</span>
					</div>
				</label>
				<label class="mb-2 flex items-start">
					<input
						class="radio radio-sm mr-2"
						type="radio"
						name="url-pref"
						value="npub"
						bind:group={store.stored_url_pref}
					/>
					<div class="flex flex-col break-all">
						<span>
							<span class="font-bold">&lt;npub&gt;/&lt;identifier&gt;</span>
							<span class="text-gray-500"
								>eg.
								gitworkshop.dev/npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z/amethyst</span
							>
						</span>
					</div>
				</label>
				<label class="mb-2 flex items-start">
					<input
						class="radio radio-sm mr-2"
						type="radio"
						name="url-pref"
						value="naddr"
						bind:group={store.stored_url_pref}
					/>
					<div class="flex flex-col break-all">
						<span>
							<span class="font-bold">&lt;naddr&gt;</span>
							<span class="text-gray-500">
								eg.
								gitworkshop.dev/naddr1qvzqqqrhnypzq3svyhng9ld8sv44950j957j9vchdktj7cxumsep9mvvjthc2pjuqqyxzmt9w358jum5nw4h94</span
							>
						</span>
					</div>
				</label>
			</div>
		</div>
		<label class="label max-w-xs cursor-pointer">
			<span class="text-left">Experimental mode</span>
			<input
				type="checkbox"
				class="toggle toggle-success"
				bind:checked={store.stored_experimental}
			/>
		</label>
		<div class="divider"></div>

		<div class="mt-2 flex items-center justify-center">
			<button
				class="btn btn-error btn-sm mr-3 normal-case"
				disabled={clearing}
				onclick={() => {
					clearDatabases();
				}}
			>
				{#if clearing}
					Clearing Database and Cache
				{:else}
					Clear Database and Cache
				{/if}
			</button>
			<div class="grow">useful if gitworkshop is misbehaving</div>
		</div>

		<div class="modal-action">
			<button class="btn btn-sm" onclick={done}>Close</button>
		</div>
	</div>
</dialog>
