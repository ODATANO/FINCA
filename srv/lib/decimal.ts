/**
 * Exact decimal arithmetic for financial amounts.
 *
 * Avoids IEEE-754 float drift on `Decimal(23,2)` values from CDS by working
 * in scaled BigInt (×100). Sufficient for ledger-style sums up to ~9 × 10^16.
 */

const SCALE = 2;
const SCALE_FACTOR = 100n;

/**
 * Parse a decimal string/number into scaled BigInt cents.
 * Accepts: "1234.56", "-12.5", "0", 1234.56, "1.005" (truncates to 2 decimals).
 */
export function toCents(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const s = String(value).trim();

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) throw new Error(`Invalid decimal: ${s}`);

  const [, sign, intPart, fracPart = ''] = match;
  const fracPadded = (fracPart + '00').slice(0, SCALE);
  const cents = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPadded);
  return sign === '-' ? -cents : cents;
}

/** Format scaled BigInt back to "X.XX" string. */
export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  const frac = fracPart.toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${intPart.toString()}.${frac}`;
}

/**
 * Sum a list of decimal values exactly. Returns string "X.XX".
 * Used for double-entry balance check where any non-zero result is an error.
 */
export function sumDecimalsExact(values: Array<string | number | null | undefined>): string {
  let total = 0n;
  for (const v of values) total += toCents(v);
  return fromCents(total);
}
