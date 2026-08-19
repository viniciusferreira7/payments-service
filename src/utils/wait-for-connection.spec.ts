import { waitForConnection } from './wait-for-connection';

describe('waitForConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true without waiting when the first attempt succeeds', async () => {
    const callback = vi.fn().mockReturnValue(true);

    const promise = waitForConnection({ callback });

    await expect(promise).resolves.toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    // Nothing was scheduled: a ready service must not pay the retry delay.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries until the service answers', async () => {
    const callback = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const promise = waitForConnection({
      maxAttempt: 5,
      delayMs: 100,
      callback,
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).resolves.toBe(true);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('numbers the attempts from 1', async () => {
    const callback = vi.fn().mockReturnValue(false);

    const promise = waitForConnection({
      maxAttempt: 3,
      delayMs: 100,
      callback,
    });
    await vi.advanceTimersByTimeAsync(300);
    await promise;

    expect(callback).toHaveBeenNthCalledWith(1, 1);
    expect(callback).toHaveBeenNthCalledWith(2, 2);
    expect(callback).toHaveBeenNthCalledWith(3, 3);
  });

  it('resolves false once the attempts run out', async () => {
    const callback = vi.fn().mockReturnValue(false);

    const promise = waitForConnection({
      maxAttempt: 3,
      delayMs: 100,
      callback,
    });
    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).resolves.toBe(false);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('waits delayMs between attempts', async () => {
    const callback = vi.fn().mockReturnValue(false);

    // The first attempt runs synchronously, before the first `await`.
    waitForConnection({ maxAttempt: 3, delayMs: 500, callback });
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('defaults to 10 attempts every 500ms', async () => {
    const callback = vi.fn().mockReturnValue(false);

    const promise = waitForConnection({ callback });
    await vi.advanceTimersByTimeAsync(10 * 500);

    await expect(promise).resolves.toBe(false);
    expect(callback).toHaveBeenCalledTimes(10);
  });

  it('never probes when maxAttempt is 0', async () => {
    const callback = vi.fn().mockReturnValue(true);

    await expect(waitForConnection({ maxAttempt: 0, callback })).resolves.toBe(
      false
    );
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects instead of retrying when the probe throws', async () => {
    const failure = new Error('ECONNREFUSED');
    const callback = vi.fn().mockImplementation(() => {
      throw failure;
    });

    await expect(waitForConnection({ callback })).rejects.toThrow(failure);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
