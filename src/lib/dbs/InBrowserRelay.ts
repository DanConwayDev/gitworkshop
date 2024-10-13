import { openDB } from 'nostr-idb'
const db = await openDB('InBrowserRelay')

export default db
