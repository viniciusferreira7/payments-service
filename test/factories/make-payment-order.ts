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
export const DEFAULT_ORDER_ID = '0b8f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
export const DEFAULT_USER_ID = '7d1e2f3a-4b5c-4d6e-9f70-8192a3b4c5d6';

export function makePaymentOrder<
  T extends PaymentOrderMessage = PaymentOrderMessage,
>(overrides: Partial<T> = {}): T {
  return {
    orderId: DEFAULT_ORDER_ID,
    userId: DEFAULT_USER_ID,
    amount: 100,
    discount: 0,
    items: [{ productId: 'product-1', quantity: 1, price: 100 }],
    paymentMethod: 'credit_card',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as T;
}

export function makeRejectedPaymentOrder<
  T extends PaymentOrderMessage = PaymentOrderMessage,
>(overrides: Partial<T> = {}): T {
  return makePaymentOrder<T>({ amount: 999, ...overrides } as Partial<T>);
}
