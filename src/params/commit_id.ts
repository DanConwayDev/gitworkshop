import type { ParamMatcher } from '@sveltejs/kit';

/**
 * Validates Git commit IDs (SHA-1 or SHA-256 hashes)
 * - SHA-1: 40 hexadecimal characters
 * - SHA-256: 64 hexadecimal characters
 * - Also accepts shortened versions (minimum 7 characters for practical use)
 */
export const match = ((param: string): param is string => {
	// Git commit IDs are hexadecimal strings
	// Full SHA-1: 40 chars, Full SHA-256: 64 chars
	// Shortened versions: typically 7-40 chars for SHA-1, 7-64 for SHA-256
	const commitIdRegex = /^[0-9a-f]{7,64}$/i;
	return commitIdRegex.test(param);
}) satisfies ParamMatcher;
