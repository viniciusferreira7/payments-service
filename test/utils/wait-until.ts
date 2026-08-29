import { waitForConnection } from '@/utils/wait-for-connection';

interface WaitUntilOptions {
  maxAttempt?: number;
  delayMs?: number;
}

export async function waitUntil(
  description: string,
  predicate: () => Promise<boolean>,
  { maxAttempt = 50, delayMs = 100 }: WaitUntilOptions = {}
): Promise<void> {
  const settled = await waitForConnection({
    maxAttempt,
    delayMs,
    callback: predicate,
  });

  if (!settled) {
    throw new Error(`Timed out waiting until ${description}`);
  }
}
