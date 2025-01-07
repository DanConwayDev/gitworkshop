import type { NostrEvent } from 'nostr-tools';
import type { RelayUpdate, RelayUpdateRepoAnn, RelayUpdateUser } from './relay-checks';
import type { Metadata, RelayList } from 'nostr-tools/kinds';

export interface ProcessorUpdate {
	event: NostrEvent | undefined;
	relay_updates: RelayUpdate[];
}

export interface ProcessorRepoUpdate {
	event: (NostrEvent & { kind: 30617 }) | undefined;
	relay_updates: RelayUpdateRepoAnn[];
}

export interface ProcessorPubkeyUpdate {
	event: (NostrEvent & { kind: Metadata | RelayList }) | undefined;
	relay_updates: RelayUpdateUser[];
}
