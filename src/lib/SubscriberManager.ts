class SubscriberManager {
	private subscriber_queries = new Map<
		string,
		{ subscribers: number; unsubscribers: (() => void)[] }
	>();

	/**
	 * adds a subscriber to subscriber query. if query isn't present, create it
	 * @param query
	 * @returns true if query is new, false if query exists
	 */
	add(query: string) {
		const subscriber_query = this.subscriber_queries.get(query) || {
			subscribers: 0,
			unsubscribers: []
		};
		const is_new_query = subscriber_query.subscribers === 0;
		subscriber_query.subscribers++;
		this.subscriber_queries.set(query, subscriber_query);
		return is_new_query;
	}

	has(query: string) {
		return this.subscriber_queries.has(query);
	}

	/**
	 * add an unsubriber to a query if it exists, otherwise call it straight away
	 */
	addUnsubsriber(query: string, unsubsriber: () => void) {
		const subscriber_query = this.subscriber_queries.get(query);
		if (!subscriber_query) {
			unsubsriber();
		} else {
			subscriber_query.unsubscribers.push(unsubsriber);
		}
	}

	/**
	 * remove a subscriber
	 * @param query
	 * @returns true when their are no remaining subscribers for the query
	 */
	remove(query: string) {
		const subscriber_query = this.subscriber_queries.get(query);
		if (!subscriber_query) return true;
		subscriber_query.subscribers = subscriber_query.subscribers - 1;
		if (subscriber_query.subscribers == 0) {
			subscriber_query.unsubscribers.forEach((unsubsriber) => unsubsriber());
			this.subscriber_queries.delete(query);
			return true;
		}
		return false;
	}
}

export default SubscriberManager;
