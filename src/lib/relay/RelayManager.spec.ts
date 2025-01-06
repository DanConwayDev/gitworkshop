import { beforeEach, describe, expect, it } from 'vitest';
import { createFiltersGroupedBySince } from './RelayManager';
import type { Filter } from 'nostr-tools';

describe('createFiltersGroupedBySince', () => {
	const replication_delay = 15 * 60; // 900 seconds
	let result: (Filter & {
		authors: string[];
	})[];

	describe('when no items are provided', () => {
		it('should return an empty array', () => {
			const items = new Map();
			result = createFiltersGroupedBySince(items);
			expect(result).toEqual([]);
		});
	});

	describe('when a single item is provided', () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: 10000, last_update: 9000 });
			result = createFiltersGroupedBySince(items);
		});

		it('should return a filter with that author', () => {
			expect(result).toHaveLength(1);
			expect(result[0].authors).toEqual(['author1']);
		});

		it('should have since value of last_check minus replication_delay', () => {
			expect(result[0].since).toBe(10000 - replication_delay); // 10000 - 900 = 9100
		});
	});

	describe("when every item's last_update is before earliest last_check minus replication_delay", () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: 10000, last_update: 8000 });
			items.set('author2', { last_check: 9500, last_update: 7000 });
			items.set('author3', { last_check: 9000, last_update: 7500 });
			result = createFiltersGroupedBySince(items);
		});

		it('should return a single filter with all authors', () => {
			expect(result).toHaveLength(1);
			expect(result[0].authors).toEqual(['author3', 'author2', 'author1']);
		});

		it('should have since value of the oldest last_check minus replication_delay ', () => {
			expect(result[0].since).toBe(9000 - replication_delay); // 9000 - 900 = 8100
		});
	});

	describe("when a item's last_update is greater than earliest last_check minus replication_delay", () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: 10000, last_update: 8500 });
			items.set('author2', { last_check: 9500, last_update: 7000 });
			items.set('author3', { last_check: 9000, last_update: 7500 });
			result = createFiltersGroupedBySince(items);
		});

		it('should return two filters', () => {
			expect(result).toHaveLength(2); // Expecting two filters
		});
		describe('first filter includes older items with older last_check', () => {
			it('should include authors with defined last_check', () => {
				expect(result[0].authors).toEqual(['author3', 'author2']);
			});
			it('should have the older last_check minus replication_delay', () => {
				expect(result[0].since).toBe(9000 - replication_delay); // 9000 - 900 = 8100
			});
		});
		describe('last filter', () => {
			it('should include the newer item', () => {
				expect(result[1].authors).toEqual(['author1']); // Second filter with undefined last_check
			});

			it('should have since of last_check  minus replication_delay', () => {
				expect(result[1].since).toBe(10000 - replication_delay); // 10000 - 900 = 9100
			});
		});
	});

	describe('when a item with the oldest last_check has a last_update is within replication_delay', () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: 10000, last_update: 8000 });
			items.set('author2', { last_check: 9500, last_update: 7000 });
			items.set('author3', { last_check: 7000, last_update: 8000 });
			result = createFiltersGroupedBySince(items);
		});

		it('since should be the last_update', () => {
			expect(result[0].since).toBe(8000);
		});
	});

	describe("when an item's last_check is recent but last_update is undefined", () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: 10000, last_update: undefined });
			items.set('author2', { last_check: 9500, last_update: 7000 });
			result = createFiltersGroupedBySince(items);
		});
		it('should be included in a filter with since undefined', () => {
			expect(result).toHaveLength(2);
			expect(result[1].authors).toEqual(['author1']);
			expect(result[1].since).toBeUndefined(); // since should be undefined
		});
	});

	describe("when an item's last_update is recent last_check is undefined", () => {
		beforeEach(() => {
			const items = new Map();
			items.set('author1', { last_check: undefined, last_update: 10000 });
			items.set('author2', { last_check: 9500, last_update: 7000 });
			result = createFiltersGroupedBySince(items);
		});
		it('should be included in a filter with since undefined', () => {
			expect(result).toHaveLength(2);
			expect(result[1].authors).toEqual(['author1']);
			expect(result[1].since).toBeUndefined(); // since should be undefined
		});
	});
});
