interface WaitForConnectionParams {
  maxAttempt?: number;
  delayMs?: number;
  callback: (attempt: number) => boolean | Promise<boolean>;
}

export async function waitForConnection({
  maxAttempt = 10,
  delayMs = 500,
  callback,
}: WaitForConnectionParams): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempt; attempt++) {
    const result = await callback(attempt);
    if (result) return true;

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}
