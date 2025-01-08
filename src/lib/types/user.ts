import {
	type WebSocketUrl,
	type Timestamp,
	type PubKeyString,
	type Npub,
	type EventIdString,
	type PubKeyTableItem,
	isRelayCheck
} from '$lib/types';
import { isHexKey, unixNow, type ProfileContent } from 'applesauce-core/helpers';
import { npubEncode } from 'nostr-tools/nip19';

interface PubkeyEventStamp {
	event_id: EventIdString;
	created_at: Timestamp;
}

export interface PubKeyMetadataInfo {
	fields: ProfileContent;
	stamp: PubkeyEventStamp | undefined;
}

export interface PubKeyRelayInfo {
	read: WebSocketUrl[];
	write: WebSocketUrl[];
	stamp: PubkeyEventStamp | undefined;
}
export interface PubKeyInfo {
	pubkey: PubKeyString;
	npub: Npub;
	metadata: PubKeyMetadataInfo;
	relays: PubKeyRelayInfo;
}

export const createPubKeyInfo = (pubkey: PubKeyString): PubKeyInfo => {
	return {
		pubkey: pubkey,
		npub: isHexKey(pubkey) ? npubEncode(pubkey) : 'npub1invalidkey',
		metadata: {
			fields: {},
			stamp: undefined
		},
		relays: {
			read: [],
			write: [],
			stamp: undefined
		}
	};
};

export const isPubKeyMetadataLoading = (info: PubKeyTableItem | undefined): boolean => {
	if (!info) return true;
	if (Object.keys(info.metadata.fields).length === 0) {
		return Object.keys(info.relays_info).some((url) =>
			info.relays_info[url as WebSocketUrl].huristics.some(
				(v) => isRelayCheck(v) && v.timestamp > unixNow() - 20 && !v.up_to_date
			)
		);
	}
	return false;
};

export function getName(user: PubKeyInfo, truncate_above = 25): string {
	if (!user) return '';
	return truncate(
		Object.keys(user.metadata.fields).length > 0
			? user.metadata.fields.name
				? user.metadata.fields.name
				: user.metadata.fields.displayName
					? user.metadata.fields.displayName
					: truncateNpub(user.npub)
			: truncateNpub(user.npub),
		truncate_above
	);
}

function truncateNpub(npub: string): string {
	return `${npub.substring(0, 9)}...`;
}

function truncate(s: string, truncate_above = 20): string {
	if (s.length < truncate_above || truncate_above < 5) return s;
	return `${s.substring(0, truncate_above - 3)}...`;
}
