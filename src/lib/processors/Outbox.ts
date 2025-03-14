import db from '$lib/dbs/LocalDb';
import type { OutboxRelayProcessorUpdate } from '$lib/types';
import { unixNow } from 'applesauce-core/helpers';

export const processOutboxUpdates = async (updates: OutboxRelayProcessorUpdate[]) => {
	const items = await db.outbox.bulkGet([...new Set(updates.map((u) => u.id))]);
	const map = new Map(items.filter((e) => !!e).map((e) => [e.id, e]));

	map.forEach((item) => {
		updates.forEach((u) => {
			if (u.id !== item.id) return;
			item.relay_logs.forEach((s) => {
				if (s.url === u.relay) {
					s.attempts.push({
						success: u.success,
						timestamp: unixNow(),
						msg: u.msg
					});
					if (u.success) {
						s.success = true;
					}
				}
			});
		});
		const groups = new Set(item.relay_logs.flatMap((l) => l.groups));
		item.broadly_sent = [...groups].every((group) => {
			const logs = item.relay_logs.filter((l) => l.groups.includes(group));
			return logs.length < 2 || logs.some((l) => l.success);
		});
		const waiting = item.relay_logs.some((l) => {
			if (l.success) return false;
			if (l.attempts.length == 0) return true;
			const last = l.attempts[l.attempts.length - 1];
			if (last.msg.indexOf('rate') > 0 || last.msg.indexOf('timeout') > 0) return true;
			return false;
		});
	});
	await db.outbox.bulkPut([...map.values()]);
};
