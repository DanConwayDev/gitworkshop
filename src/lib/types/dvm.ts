import type { NostrEvent } from 'nostr-tools';
import {
	isHttpUrl,
	type NonReplaceableEventAttribution,
	type PubKeyString,
	type Timestamp
} from './general';
import {
	getParamTagValue,
	getTagMultiValue,
	getTagValue,
	getValueOfEachTagOccurence
} from '$lib/utils';
import { unixNow } from 'applesauce-core/helpers';

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

export interface DVMActionRequest extends NonReplaceableEventAttribution {
	git_address: string;
	git_ref: string;
	workflow_filepath: string;
	workflow_timeout: string;
	commit_id?: string;
}

export const eventToDVMActionRequest = (event: NostrEvent): DVMActionRequest => {
	return {
		uuid: event.id,
		author: event.pubkey,
		created_at: event.created_at,
		git_address: getParamTagValue(event.tags, 'git_address') || '',
		git_ref: getParamTagValue(event.tags, 'git_ref') || '',
		workflow_timeout: getParamTagValue(event.tags, 'workflow_timeout') || '',
		workflow_filepath: getParamTagValue(event.tags, 'workflow_filepath') || '',
		commit_id: getTagValue(event.tags, 'commit')
	};
};

export type ActionRunStatus =
	| 'pending_response'
	| 'payment_issue'
	| 'processing'
	| 'success'
	| 'error'
	| 'no_response';

function isActionRunStatus(status: string): status is ActionRunStatus {
	return (
		status === 'pending_response' ||
		status === 'payment_issue' ||
		status === 'processing' ||
		status === 'success' ||
		status === 'error' ||
		status === 'no_response'
	);
}

export function getThirdTagValue(
	tags: string[][],
	first: string,
	second: string
): string | undefined {
	return tags.find((t) => t.length > 2 && t[0] === first && t[1] === second)?.[2];
}

export interface DVMActionSummary extends DVMActionRequest {
	status: ActionRunStatus;
	status_commentary: string;
}

export const eventsToDVMActionSummary = (
	request: NostrEvent,
	responses: NostrEvent[]
): DVMActionSummary => {
	const statuses: { status: ActionRunStatus; status_commentary: string }[] = responses
		.map((r) => getTagMultiValue(r.tags, 's'))
		.filter(
			(a): a is [ActionRunStatus, string] =>
				!!a && isActionRunStatus(a[0].replace('payment-required', 'payment_issue'))
		)
		.map((a) => ({
			status: a[0].replace('payment-required', 'payment_issue') as ActionRunStatus,
			status_commentary: a[1] ?? ''
		}));

	const status_o =
		statuses.find((s) => s.status === 'success') ||
		statuses.find((s) => s.status === 'error') ||
		statuses.find((s) => s.status === 'processing') ||
		statuses.find((s) => s.status === 'payment_issue') ||
		(request.created_at > unixNow() - 30
			? {
					status: 'pending_response',
					status_commentary: 'Pending Response...'
				}
			: {
					status: 'no_response',
					status_commentary: "DVM didn't respond"
				});

	return {
		...eventToDVMActionRequest(request),
		...status_o
	};
};
