<script lang="ts">
	import { goto } from '$app/navigation';
	import { search_input, search_query } from '$lib/stores/search';
	import Container from './Container.svelte';

	export let logged_in_user: { user_profile_goes_here: boolean } | undefined = undefined;
	export let nip07_plugin: boolean | undefined = undefined;
	export let login_function = () => {};
	export let singup_function = () => {};
	// this was be an import from users store
	let logout = () => {};

	function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		search_query.set($search_input);
		if ($search_input.length > 0) goto(`/search`);
	}
</script>

<div class="bg-base-400">
	<Container>
		<div class="navbar">
			<div class="navbar-start">
				<a class="h-8 overflow-hidden align-middle" href="/">
					<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
				</a>
				<div class="p-2"></div>
				<a href="/" class="btn btn-ghost btn-sm normal-case">Home</a>
				<a href="/quick-start" class="btn btn-ghost btn-sm normal-case">Quick Start</a>
			</div>
			<div class="navbar-center"></div>
			<div class="navbar-end gap-4">
				<form on:submit={handleSearch}>
					<label class="input input-bordered input-sm flex items-center gap-2">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="h-4 w-4 opacity-70"
						>
							<path
								fill-rule="evenodd"
								d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
								clip-rule="evenodd"
							/>
						</svg>
						<input type="text" class="grow" placeholder="Search" bind:value={$search_input} />
					</label>
				</form>
				{#if logged_in_user}
					<div class="dropdown dropdown-end">
						<div tabindex="0" role="button" class="m-1">[user placeholder]</div>
						<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
						<ul
							tabindex="0"
							class="menu dropdown-content rounded-box bg-base-400 z-[1] -mr-4 p-2 shadow"
						>
							<li>[user placeholder]</li>
							<li>
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_missing_attribute -->
								<a
									on:click={() => {
										logout();
									}}>Logout</a
								>
							</li>
						</ul>
					</div>
				{:else if nip07_plugin === undefined}
					<div class="skeleton h-8 w-20"></div>
				{:else if nip07_plugin}
					<button
						on:click={() => {
							login_function();
						}}
						class="btn btn-ghost btn-sm normal-case">Login</button
					>
				{:else}
					<button
						on:click={() => {
							singup_function();
						}}
						class="btn btn-ghost btn-sm normal-case">Sign up</button
					>
				{/if}
			</div>
		</div>
	</Container>
</div>
