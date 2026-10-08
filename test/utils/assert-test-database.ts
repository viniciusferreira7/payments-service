/**
 * Guards specs that reset the schema (`dataSource.synchronize(true)` drops
 * every table). They may only ever run against a throwaway `*_test` database,
 * never the dev one that shares this machine.
 */
export function assertTestDatabase(url: string | undefined): void {
  const database = url ? new URL(url).pathname.replace(/^\//, '') : '';

  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to reset "${database || '<no DATABASE_URL>'}": the int lane only runs against a *_test database`
    );
  }
}
