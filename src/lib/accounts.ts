import { AccountManager, type SerializedAccount } from 'applesauce-accounts';
import store from './store.svelte';
import type { AccountSummary } from './types';
import { NostrConnectAccount, registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import { NostrConnectSigner, type NostrConnectConnectionMethods } from 'applesauce-signers';
import { SimplePool } from 'nostr-tools';

const manager = new AccountManager();

const updateStore = () => {
	store.accounts = manager.toJSON().map(accountJSONtoAccountSummary);
	const active = manager.getActive();
	store.logged_in_account = active ? accountJSONtoAccountSummary(active.toJSON()) : undefined;
};

registerCommonAccountTypes(manager);
const accountJSONtoAccountSummary = (a: SerializedAccount<unknown, unknown>): AccountSummary => ({
	id: a.id,
	pubkey: a.pubkey,
	type: a.type
});

export const nostr_connect_pools = new SimplePool();

const nostr_connect_methods: NostrConnectConnectionMethods = {
	async onSubOpen(filters, relays, onEvent) {
		nostr_connect_pools.subscribeMany(relays, filters, {
			onevent: (event) => {
				onEvent(event);
			}
		});
	},
	async onSubClose() {},
	async onPublishEvent(event, relays) {
		nostr_connect_pools.publish(relays, event);
	}
};

NostrConnectAccount.createConnectionMethods = () => nostr_connect_methods;

// load accounts from storage
manager.fromJSON(JSON.parse(localStorage.getItem('accounts') || '[]'));
// load active account from storage
const active = localStorage.getItem('active');
if (active) {
	manager.setActive(active);
	const a = manager.getAccount(active);
	store.logged_in_account = a ? accountJSONtoAccountSummary(a) : undefined;
}
// set store
updateStore();
// update storage and store on changes
manager.accounts$.subscribe(() => {
	localStorage.setItem('accounts', JSON.stringify(manager.toJSON()));
	updateStore();
});
manager.active$.subscribe((account) => {
	if (account) localStorage.setItem('active', account.id);
	else localStorage.removeItem('active');
	updateStore();
});

const accounts_manager = manager;

export default accounts_manager;
