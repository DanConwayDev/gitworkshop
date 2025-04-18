import {
	DeletionKind,
	NostrWalletKind,
	NostrWalletSpendHistorynKind,
	NostrWalletTokenKind
} from '$lib/kinds';
import type { PubKeyString } from '$lib/types';
import type { Filter } from 'nostr-tools';

export const createWalletFilter = (pubkey: PubKeyString): Filter[] => {
	return [
		{
			kinds: [NostrWalletKind, NostrWalletTokenKind],
			authors: [pubkey]
		},
		{
			kinds: [DeletionKind],
			'#k': [NostrWalletTokenKind.toString()],
			authors: [pubkey]
		}
	];
};
export const createWalletHistoryFilter = (pubkey: PubKeyString, limit: number = 100): Filter[] => {
	return [
		{
			kinds: [NostrWalletSpendHistorynKind],
			authors: [pubkey],
			limit
		}
	];
};
