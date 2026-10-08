/**
 * Money is stored as decimal(10,2) and handled in whole cents: adding or
 * multiplying decimal amounts as JS numbers drifts (19.9 * 3 is
 * 59.699999999999996), cents never do.
 */

/** The largest decimal(10,2): 99999999.99. */
export const MAX_MONEY_CENTS = 9_999_999_999;

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
