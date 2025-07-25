<script lang="ts">
	import { icons_misc } from '$lib/icons';
	import { createPubKeyInfo, isPubkeyString, type PubKeyString } from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre.svelte';
	import { getName } from '$lib/types';
	import CopyField from '../CopyField.svelte';
	import { onMount } from 'svelte';
	import { UserRouteStringCreator } from '$lib/helpers.svelte';

	let {
		user,
		inline = false,
		size = 'md',
		avatar_only = false,
		in_event_header = false,
		link_to_profile = true,
		avatar_on_right = false,
		no_avatar = false,
		in_group = false,
		on_link_press = () => {}
	}: {
		user?: PubKeyString;
		inline?: boolean;
		size?: 'xs' | 'sm' | 'md' | 'full';
		avatar_only?: boolean;
		in_event_header?: boolean;
		link_to_profile?: boolean;
		avatar_on_right?: boolean;
		no_avatar?: boolean;
		in_group?: boolean;
		on_link_press?: () => void;
	} = $props();

	let pubkey = $derived(user);

	let info_query = $derived(
		isPubkeyString(pubkey) ? query_centre.fetchPubkeyName(pubkey) : undefined
	);
	// prevent flashing with pubkey when info in db (allow db record to load before showing loading)
	let mounting = $state(true);
	onMount(() => {
		setTimeout(() => (mounting = false), 100);
	});
	let info = $derived(
		// show loading until record is created in db by fetchPubkeyName
		info_query?.current ?? {
			...createPubKeyInfo(pubkey || ''),
			relays_info: {},
			loading: true
		}
	);
	// let info = $derived(info_query.current);
	let display_name = $derived(getName(info));
	let not_found_and_loading = $derived(info.loading && !info.metadata.stamp);
	let pic_url = $derived(info.metadata.fields.image ?? info.metadata.fields.picture ?? undefined);
	let failed_pic_url: string | undefined = $state(undefined);
	let hovered = $state(false);
	let user_link_creator = $derived(
		pubkey && hovered ? new UserRouteStringCreator(pubkey) : undefined
	);
	let user_link = $derived(user_link_creator?.s ?? info.npub);
</script>

{#if info && (info.metadata.stamp || !mounting)}
	{#if pubkey && link_to_profile && size !== 'full'}
		<a
			onmouseenter={() => {
				hovered = true;
			}}
			onclick={on_link_press}
			class:inline-block={inline}
			class="text-inherit no-underline"
			href="/{user_link}"
		>
			{@render inside()}
		</a>
	{:else}
		<div class:inline-block={inline}>
			{@render inside()}
		</div>
	{/if}
{/if}

{#snippet inside()}
	<div
		class:my-2={!inline}
		class:text-xs={size === 'xs'}
		class:text-sm={size === 'sm'}
		class:text-md={size === 'md'}
		class:align-middle={inline}
		class:flex={!inline}
		class:items-center={!inline}
	>
		<div
			class:inline-block={inline}
			class:align-middle={inline}
			class:flex-none={!inline}
			class:order-1={avatar_on_right}
			class:hidden={no_avatar}
		>
			{#if link_to_profile && size === 'full'}
				<a
					onmouseenter={() => {
						hovered = true;
					}}
					onclick={on_link_press}
					href="/{user_link}"
				>
					{@render profileImage()}</a
				>
			{:else}
				{@render profileImage()}
			{/if}
		</div>
		<div
			class:text-xl={size === 'full'}
			class:width-max-prose={size === 'full'}
			class:pl-4={!avatar_on_right && !inline && size === 'full'}
			class:pl-3={!avatar_on_right && !inline && size === 'md'}
			class:pl-2={!avatar_on_right && !inline && (size === 'sm' || size === 'xs')}
			class:pr-4={avatar_on_right && !inline && size === 'full'}
			class:pr-3={avatar_on_right && !inline && size === 'md'}
			class:pr-2={avatar_on_right && !inline && (size === 'sm' || size === 'xs')}
			class:pl-0={inline}
			class:flex-auto={!inline}
			class:m-auto={!inline}
			class:inline-block={inline && !avatar_only}
			class:hidden={avatar_only}
			class:opacity-40={in_event_header}
		>
			{#if not_found_and_loading}
				<div
					class="skeleton w-24"
					class:h-4={size === 'md'}
					class:h-3={size === 'sm'}
					class:h-2.5={size === 'xs'}
				></div>
			{:else}
				<span class:font-bold={in_event_header || size === 'full'}>
					{#if link_to_profile && size === 'full'}
						<a
							onmouseenter={() => {
								hovered = true;
							}}
							onclick={on_link_press}
							href="/{user_link}"
						>
							{display_name}
						</a>
					{:else}
						{display_name}
					{/if}
				</span>
			{/if}
			{#if size === 'full'}
				<CopyField icon={icons_misc.key} content={info.npub} no_border truncate={[10, 10]} />
				{#if info.metadata.fields && info.metadata.fields.lud16}
					<CopyField icon={icons_misc.lightning} content={info.metadata.fields.lud16} no_border />
				{/if}
				{#if info.metadata.fields && info.metadata.fields.website}
					<a
						href={info.metadata.fields.website}
						target="_blank"
						class="items items-top mt-1 flex w-full opacity-60"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="fill-base-content mr-1 inline h-4 w-4 flex-none opacity-50"
						>
							{#each icons_misc.link as d}
								<path {d} />
							{/each}
						</svg>
						<div class="link-secondary text-sm">
							{info.metadata.fields.website}
						</div>
					</a>
				{/if}
				{#if size === 'full' && info.metadata.fields && info.metadata.fields.about}
					<div class="items items-top flex max-w-md opacity-60">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="fill-base-content mt-1 mr-1 inline h-4 w-4 flex-none opacity-50"
						>
							{#each icons_misc.info as d}
								<path {d} />
							{/each}
						</svg>

						{#if not_found_and_loading}
							<div class="w.max-lg skeleton h-3"></div>
						{:else}
							<div class="text-sm">
								{info.metadata.fields?.about}
								<!-- <ParsedContent content={info.metadata.fields?.about} /> -->
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/snippet}

{#snippet profileImage()}
	<div
		class:avatar={!in_group}
		class:inline-block={inline}
		class:h-32={!inline && size === 'full'}
		class:w-32={!inline && size === 'full'}
		class:h-8={!inline && size === 'md'}
		class:w-8={!inline && size === 'md'}
		class:h-4={!inline && size === 'sm'}
		class:w-4={!inline && size === 'sm'}
		class:h-5={inline && size === 'md'}
		class:w-5={inline && size === 'md'}
		class:h-3.5={(inline && size === 'sm') || size === 'xs'}
		class:w-3.5={(inline && size === 'sm') || size === 'xs'}
		class:rounded={!in_group}
		class:rounded-full={in_group}
		class:skeleton={not_found_and_loading}
		class:bg-neutral={!pic_url || pic_url !== failed_pic_url}
		class:placeholder={!pic_url || pic_url !== failed_pic_url}
	>
		{#if pic_url && pic_url !== failed_pic_url}
			<img
				class="not-prose my-0"
				src={pic_url}
				alt={display_name}
				onerror={() => (failed_pic_url = $state.snapshot(pic_url))}
			/>
		{:else}
			<div class="">
				<div
					class="bg-neutral text-neutral-content flex w-full items-center justify-center rounded text-center"
					class:h-32={!inline && size === 'full'}
					class:w-32={!inline && size === 'full'}
					class:h-8={!inline && size === 'md'}
					class:w-8={!inline && size === 'md'}
					class:h-4={!inline && size === 'sm'}
					class:w-4={!inline && size === 'sm'}
					class:h-5={inline && size === 'md'}
					class:w-5={inline && size === 'md'}
					class:h-3.5={(inline && size === 'sm') || size === 'xs'}
					class:w-3.5={(inline && size === 'sm') || size === 'xs'}
				>
					<span style={(inline && size === 'sm') || size === 'xs' ? 'font-size: 0.6rem;' : ''}>
						{display_name.startsWith('npub1') || display_name.startsWith('InvalidH')
							? ''
							: display_name.slice(0, 1).toLocaleUpperCase()}</span
					>
				</div>
			</div>
		{/if}
	</div>
{/snippet}
