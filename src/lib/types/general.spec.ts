import { describe, expect, it } from 'vitest';
import { isNip05, isNip05Standardized, standardizeNip05 } from './general';

describe('Nip05Address Validation', () => {
	describe('isNip05', () => {
		it('should return true for valid Nip05 addresses', () => {
			expect(isNip05('user@example.com')).toBe(true);
			expect(isNip05('example.com')).toBe(true);
			expect(isNip05('subdomain.example.com')).toBe(true);
		});

		it('should return false for invalid Nip05 addresses', () => {
			expect(isNip05('user@.com')).toBe(false);
			expect(isNip05('user@domain@domain.com')).toBe(false);
			expect(isNip05('user..name@example.com')).toBe(false);
			expect(isNip05('user name@example.com')).toBe(false);
			expect(isNip05('user@domain')).toBe(false);
			expect(isNip05('user@domain.')).toBe(false);
			expect(isNip05('user@-example.com')).toBe(false);
			expect(isNip05('example-.com')).toBe(false);
		});
	});

	describe('isNip05Standardized', () => {
		it('should return true for valid standardized Nip05 addresses', () => {
			expect(isNip05Standardized('user@example.com')).toBe(true);
			expect(isNip05Standardized('user.name@example.com')).toBe(true);
			expect(isNip05Standardized('user+tag@example.com')).toBe(true);
		});

		it('should return false for invalid standardized Nip05 addresses', () => {
			expect(isNip05Standardized('example.com')).toBe(false);
			expect(isNip05Standardized('user@.com')).toBe(false);
			expect(isNip05Standardized('user@domain@domain.com')).toBe(false);
			expect(isNip05Standardized('user..name@example.com')).toBe(false);
			expect(isNip05Standardized('user name@example.com')).toBe(false);
		});
	});

	describe('standardizeNip05', () => {
		it('should standardize Nip05 addresses correctly', () => {
			expect(standardizeNip05('example.com')).toBe('_@example.com');
			expect(standardizeNip05('user@example.com')).toBe('user@example.com');
		});

		it('should not modify already standardized addresses', () => {
			expect(standardizeNip05('user@example.com')).toBe('user@example.com');
			expect(standardizeNip05('another.user@example.com')).toBe('another.user@example.com');
		});
	});
});
