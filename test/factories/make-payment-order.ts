import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';

/**
 * Builds a valid payment order — one whose `amount` matches its items minus the
 * discount, so `PaymentConsumerService` accepts it.
 *
 * `createdAt` is fixed rather than `new Date()` to keep specs deterministic.
 * Override whatever the case under test needs:
 *
 * ```ts
 * makePaymentOrder({ amount: 90, discount: 10 });
 * ```
 *
 * The type parameter covers the shapes that extend the base message, such as
 * `IncomingPaymentOrderMessage`:
 *
 * ```ts
 * makePaymentOrder<IncomingPaymentOrderMessage>({ metadata: { source: 'web' } });
 * ```
 */
export function makePaymentOrder<
  T extends PaymentOrderMessage = PaymentOrderMessage,
>(overrides: Partial<T> = {}): T {
  return {
    orderId: 'order-1',
    userId: 'user-1',
    amount: 100,
    discount: 0,
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as T;
}
