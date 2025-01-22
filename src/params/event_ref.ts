import { isEventBech32, type EventBech32 } from '$lib/types';
import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string): param is EventBech32 => {
	return isEventBech32(param);
}) satisfies ParamMatcher;
