import { decimalToNumberTransformer } from './decimal-to-number.transformer';

describe('decimalToNumberTransformer', () => {
  it('reads the pg decimal string as a number', () => {
    expect(decimalToNumberTransformer.from('19.90')).toBe(19.9);
    expect(decimalToNumberTransformer.from('0.00')).toBe(0);
    expect(decimalToNumberTransformer.from('99999999.99')).toBe(99999999.99);
  });

  it('keeps null as null', () => {
    expect(decimalToNumberTransformer.from(null)).toBeNull();
  });

  it('writes numbers through unchanged', () => {
    expect(decimalToNumberTransformer.to(19.9)).toBe(19.9);
  });
});
