import { assertTestDatabase } from './assert-test-database';

describe('assertTestDatabase', () => {
  it('accepts a *_test database', () => {
    expect(() =>
      assertTestDatabase('postgres://test:test@localhost:5440/checkout_db_test')
    ).not.toThrow();
  });

  it.each([
    'postgres://postgres:postgres@localhost:5439/checkout',
    'postgres://test:test@localhost:5440/checkout_test_backup',
    undefined,
  ])('refuses %s', (url) => {
    expect(() => assertTestDatabase(url)).toThrow(/Refusing to reset/);
  });
});
