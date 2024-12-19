import Watcher from '$lib/processors/Watcher';
import { EventStore, QueryStore } from 'applesauce-core';

const memory_db = new EventStore();

// initiate watcher to begin processing new events
new Watcher(memory_db);

export const memory_db_query_store = new QueryStore(memory_db);

export default memory_db;
