/**
 * A delivery as `channel.get` hands it back: the payload as a buffer plus the
 * AMQP properties `DlqService` reads. Pass a string to simulate a payload the
 * broker accepted but `JSON.parse` cannot.
 *
 * ```ts
 * makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }));
 * makeDlqDelivery('not json');
 * ```
 */
export function makeDlqDelivery(
  content: unknown,
  properties: Record<string, unknown> = {}
) {
  return {
    content: Buffer.from(
      typeof content === 'string' ? content : JSON.stringify(content)
    ),
    properties: { headers: undefined, ...properties },
  };
}

export type DlqDelivery = ReturnType<typeof makeDlqDelivery>;

/**
 * A channel double that models the broker rather than only recording calls.
 *
 * `get` hands out the head and holds it unacked, `ack` drops it, and a nack
 * with `requeue` puts it back at the *head*. That last detail is the point: it
 * is what makes a naive get/nack scan loop read the same message forever, so
 * specs built on this double catch that regression instead of passing against
 * a mock that would accept any call order.
 *
 * `queue` stays live, so assert on it after the call under test:
 *
 * ```ts
 * const channel = makeDlqChannel([makeDlqDelivery(makePaymentOrder())]);
 * await service.peekMessages();
 * expect(channel.queue).toHaveLength(1);
 * ```
 */
export function makeDlqChannel(initial: DlqDelivery[] = []) {
  const queue = [...initial];

  return {
    queue,
    checkQueue: vi.fn(async (name: string) => ({
      queue: name,
      messageCount: queue.length,
      consumerCount: 0,
    })),
    get: vi.fn(async () => queue.shift() ?? false),
    purgeQueue: vi.fn(async () => {
      const messageCount = queue.length;

      queue.length = 0;

      return { messageCount };
    }),
    ack: vi.fn(),
    nack: vi.fn((message: DlqDelivery, _allUpTo: boolean, requeue: boolean) => {
      if (requeue) queue.unshift(message);
    }),
  };
}

/** Reads the order ids off a queue of deliveries, to assert on its contents. */
export function orderIdsIn(queue: DlqDelivery[]): string[] {
  return queue.map((message) => JSON.parse(message.content.toString()).orderId);
}
