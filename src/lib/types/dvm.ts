import type { NostrEvent } from 'nostr-tools';
import { isHttpUrl, type PubKeyString, type Timestamp } from './general';
import { getTagValue, getValueOfEachTagOccurence } from '$lib/utils';

export interface DVMProvider {
	last_pong: Timestamp;
	pubkey: PubKeyString;
	name: string;
	about: string;
	mints: string[];
	price_per_second: string;
	unit: string;
}

export const eventToActionsDVMProvider = (event: NostrEvent): DVMProvider | undefined => {
	const price_per_second = getTagValue(event.tags, 'price');
	const unit = getTagValue(event.tags, 'unit');
	const mints = getValueOfEachTagOccurence(event.tags, 'mint').filter(isHttpUrl);

	if (!price_per_second || !unit || mints.length === 0) return undefined;

	try {
		const content = JSON.parse(event.content) as {
			name: string;
			about: string;
		};
		return {
			last_pong: event.created_at,
			pubkey: event.pubkey,
			name: content.name ?? '',
			about: content.about ?? '',
			mints,
			price_per_second,
			unit
		};
	} catch {
		return undefined;
	}
};
