import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { toCents } from '@/common/money';
import { metrics } from '@/observability/metrics';

export const PAYMENT_GATEWAY_DELAY = Symbol('PAYMENT_GATEWAY_DELAY');

export type GatewayDelay = () => Promise<void>;

const MIN_LATENCY_MS = 500;
const MAX_LATENCY_MS = 2_000;

/** Waits like a real acquirer would: somewhere in [500, 2000] ms. */
export const randomLatency: GatewayDelay = () =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      MIN_LATENCY_MS +
        Math.floor(Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS + 1))
    )
  );

/** Above 10000.00 the fake acquirer refuses the charge. */
const LIMIT_CENTS = 1_000_000;

export const REJECTION_REASONS = {
  LIMIT_EXCEEDED: 'Limite excedido',
  CARD_DECLINED: 'Cartão recusado pela operadora',
} as const;

export interface ChargeResult {
  approved: boolean;
  transactionId: string;
  rejectionReason?: string;
}

/**
 * Stands in for a payment acquirer. The latency is random, the outcome is
 * not: it depends only on the amount, so a buyer can trigger each case.
 */
@Injectable()
export class FakePaymentGatewayService {
  private readonly logger = new Logger(FakePaymentGatewayService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY_DELAY) private readonly delay: GatewayDelay
  ) {}

  async charge({
    orderId,
    amount,
  }: {
    orderId: string;
    amount: number;
  }): Promise<ChargeResult> {
    const startedAt = performance.now();

    try {
      await this.delay();

      const rejectionReason = FakePaymentGatewayService.rejectionFor(amount);
      const transactionId = `fake_${randomUUID()}`;
      const outcome = rejectionReason ? 'rejected' : 'approved';

      metrics.payment_gateway_requests.add(1, { operation: 'charge', outcome });
      this.logger.log(
        `Charge for order ${orderId} ${outcome} (transaction ${transactionId})`
      );

      return rejectionReason
        ? { approved: false, transactionId, rejectionReason }
        : { approved: true, transactionId };
    } catch (error) {
      metrics.payment_gateway_requests.add(1, {
        operation: 'charge',
        outcome: 'failed',
      });
      throw error;
    } finally {
      metrics.payment_gateway_request_duration.record(
        performance.now() - startedAt,
        { operation: 'charge' }
      );
    }
  }

  private static rejectionFor(amount: number): string | undefined {
    const cents = toCents(amount);

    if (cents > LIMIT_CENTS) {
      return REJECTION_REASONS.LIMIT_EXCEEDED;
    }

    if (cents % 100 === 99) {
      return REJECTION_REASONS.CARD_DECLINED;
    }

    return undefined;
  }
}
