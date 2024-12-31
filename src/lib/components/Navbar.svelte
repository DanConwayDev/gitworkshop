<script lang="ts">
	import Container from './Container.svelte';

	export let logged_in_user: { user_profile_goes_here: boolean } | undefined = undefined;
	export let nip07_plugin: boolean | undefined = undefined;
	export let login_function = () => {};
	export let singup_function = () => {};

	// this was be an import from users store
	let logout = () => {};
</script>

<div class="bg-base-400">
	<Container>
		<div class="navbar">
			<div class="navbar-start">
				<a class="h-8 overflow-hidden align-middle" href="/">
					<img src="/icons/icon.svg" alt="gitworkshop.dev logo" class="h-full max-w-full" />
				</a>
			</div>
			<div class="navbar-center"></div>
			<div class="navbar-end gap-4">
				<a href="/repos" class="btn btn-ghost btn-sm normal-case">Repos</a>
				<a href="/quick-start" class="btn btn-ghost btn-sm normal-case">Quick Start</a>
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
