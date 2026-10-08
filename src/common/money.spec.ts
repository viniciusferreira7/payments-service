import { fromCents, MAX_MONEY_CENTS, toCents } from './money';

describe('money', () => {
  it('turns a decimal amount into whole cents', () => {
    expect(toCents(19.9)).toBe(1990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(99999999.99)).toBe(MAX_MONEY_CENTS);
  });

  it('turns cents back into a decimal amount', () => {
    expect(fromCents(5970)).toBe(59.7);
    expect(fromCents(0)).toBe(0);
  });

  // In plain numbers 19.9 * 3 is 59.699999999999996.
  it('multiplies a price by a quantity without float drift', () => {
    expect(fromCents(toCents(19.9) * 3)).toBe(59.7);
  });

  it('adds amounts without float drift', () => {
    expect(fromCents(toCents(0.1) + toCents(0.2))).toBe(0.3);
  });
});
