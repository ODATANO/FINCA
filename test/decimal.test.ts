import { toCents, fromCents, sumDecimalsExact } from '../srv/lib/decimal';

describe('decimal — exact financial arithmetic', () => {
  describe('toCents', () => {
    test.each([
      ['0', 0n],
      ['1.00', 100n],
      ['-1.00', -100n],
      ['1234.56', 123456n],
      ['-3500.00', -350000n],
      ['0.01', 1n],
      ['0.1', 10n],
      ['1', 100n],
      ['1.005', 100n],     // truncates beyond 2 decimals
      ['', 0n],
      [null, 0n],
      [undefined, 0n],
      [1234.56, 123456n]
    ])('toCents(%p) → %p', (input, expected) => {
      expect(toCents(input as any)).toBe(expected);
    });

    test('rejects garbage', () => {
      expect(() => toCents('abc')).toThrow(/Invalid decimal/);
      expect(() => toCents('1.2.3')).toThrow(/Invalid decimal/);
    });
  });

  describe('fromCents', () => {
    test.each([
      [0n, '0.00'],
      [100n, '1.00'],
      [-100n, '-1.00'],
      [123456n, '1234.56'],
      [-1n, '-0.01'],
      [9n, '0.09']
    ])('fromCents(%p) → %p', (input, expected) => {
      expect(fromCents(input)).toBe(expected);
    });
  });

  describe('sumDecimalsExact', () => {
    test('balanced double-entry sums to 0.00', () => {
      expect(sumDecimalsExact(['3500.00', '-3500.00'])).toBe('0.00');
    });

    test('unbalanced batch reports exact difference', () => {
      expect(sumDecimalsExact(['100.10', '-100.05'])).toBe('0.05');
    });

    test('handles many entries without float drift', () => {
      // 0.10 added 1000× would drift in float; here it must be exact.
      const values = Array(1000).fill('0.10');
      expect(sumDecimalsExact(values)).toBe('100.00');
    });

    test('handles huge ledger amounts', () => {
      expect(sumDecimalsExact(['999999999999999.99', '-999999999999999.99'])).toBe('0.00');
    });

    test('skips null/empty entries', () => {
      expect(sumDecimalsExact(['10.00', null, '', '-10.00'])).toBe('0.00');
    });
  });
});
