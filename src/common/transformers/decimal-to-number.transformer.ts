import type { ValueTransformer } from 'typeorm';

/**
 * `pg` returns `decimal` columns as strings to avoid float rounding. Every
 * `decimal(10,2)` value (max 99999999.99) is exactly representable as a JS
 * number, so the entity exposes a number instead.
 */
export const decimalToNumberTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
