<script lang="ts">
	import { goto } from '$app/navigation';
	import { icons_misc } from '../icons';
	import { isPubKeyMetadataLoading, type PubKeyString } from '$lib/types';
	import query_centre from '$lib/query-centre/QueryCentre';
	import { getName } from '$lib/types';
	import CopyField from '../CopyField.svelte';

	let {
		user,
		inline = false,
		size = 'md',
		avatar_only = false,
		in_event_header = false,
		link_to_profile = true,
		avatar_on_right = false
	}: {
		user: PubKeyString;
		inline?: boolean;
		size?: 'xs' | 'sm' | 'md' | 'full';
		avatar_only?: boolean;
		in_event_header?: boolean;
		link_to_profile?: boolean;
		avatar_on_right?: boolean;
	} = $props();

	let info = query_centre.fetchPubkeyName(user);

	let display_name = $derived(getName(info));
	let loading = $derived(isPubKeyMetadataLoading(info));
</script>

{#if info}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class:inline-block={inline}
		class:cursor-pointer={link_to_profile}
		onclick={() => {
			if (link_to_profile) goto(`/p/${info.npub}`);
		}}
	>
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
				class="avatar"
				class:inline-block={inline}
				class:align-middle={inline}
				class:flex-none={!inline}
				class:order-1={avatar_on_right}
			>
				<div
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
					class="rounded"
					class:skeleton={!('image' in info.metadata.fields) &&
						!('picture' in info.metadata.fields)}
					class:bg-neutral={!loading &&
						(!info.metadata.fields ||
							(!info.metadata.fields.image && !info.metadata.fields.picture))}
				>
					{#if info.metadata.fields?.image || info.metadata.fields?.picture}
						<img
							class="my-0"
							src={info.metadata.fields?.picture || info.metadata.fields?.image}
							alt={display_name}
						/>
					{/if}
				</div>
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
				class:inline-block={inline}
				class:hidden={avatar_only}
				class:opacity-40={in_event_header}
			>
				{#if loading}
					<div
						class="skeleton w-24"
						class:h-4={size === 'md'}
						class:h-3={size === 'sm'}
						class:h-2.5={size === 'xs'}
					></div>
				{:else}
					<span class:font-bold={in_event_header || size === 'full'}>{display_name}</span>
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
								class="mr-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
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
								class="mr-1 mt-1 inline h-4 w-4 flex-none fill-base-content opacity-50"
							>
								{#each icons_misc.info as d}
									<path {d} />
								{/each}
							</svg>

							{#if loading}
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
	</div>
{/if}
