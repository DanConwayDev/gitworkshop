import { EventStore, QueryStore } from 'applesauce-core';

const memory_db = new EventStore();

export const memory_db_query_store = new QueryStore(memory_db);

export default memory_db;
