/** Postgres SQLSTATE carried by a failed query. */
export async function sqlStateOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (
      (error as { driverError?: { code?: string } }).driverError?.code ?? ''
    );
  }

  throw new Error('Expected the query to fail');
}
