import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { z } from 'zod';
import { MAX_MONEY_CENTS, toCents } from '@/common/money';
import { PAYMENT_METHODS } from '@/common/payment-methods';
import { metrics } from '@/observability/metrics';
import { PaymentsService } from '@/payments/payments.service';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';

const uuid = z.uuid();

const KNOWN_PAYMENT_METHODS = new Set<string>(PAYMENT_METHODS);

/** A finite money value with at most 2 decimals, as decimal(10,2) stores it. */
const isMoney = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Math.abs(value * 100 - toCents(value)) < 1e-6;

/**
 * The amount sum alone does not make an order consistent: a negative price can
 * offset another item, so every item is checked on its own first.
 */
const isValidItem = (item: { quantity: unknown; price: unknown }) =>
  Number.isInteger(item.quantity) &&
  (item.quantity as number) >= 1 &&
  isMoney(item.price) &&
  item.price > 0;

@Injectable()
export class PaymentConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentConsumerService.name);

  constructor(
    private readonly paymentQueueService: PaymentQueueService,
    private readonly paymentsService: PaymentsService
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Starting Payment Consumer Service');
    await this.startConsuming();
  }

  private async startConsuming(): Promise<void> {
    this.logger.log('Starting to consume payment orders from queue');
    try {
      await this.paymentQueueService.consumePaymentOrders(
        this.processPaymentOrder.bind(this)
      );

      this.logger.log('Payment Consumer Service started successfully');
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to start consuming payment orders: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private async processPaymentOrder(
    message: PaymentOrderMessage
  ): Promise<void> {
    try {
      this.logger.debug(
        `Processing payment order: orderId=${message.orderId}, userId=${message.userId}, amount=${message.amount}`
      );

      const isValidMessage = this.validateMessage(message);

      if (!isValidMessage) {
        this.logger.error('Invalid payment message received');

        throw new Error('Invalid payment message received');
      }

      metrics.payment_order_amount.record(message.amount, {
        payment_method: message.paymentMethod,
      });

      this.logger.log('Payment order received and validated');

      await this.paymentsService.processPayment(message);
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to process payment for order: ${message.orderId}, error message:${errorDetails.message}`,
        errorDetails.stack
      );

      throw error;
    }
  }

  private validateMessage(message: PaymentOrderMessage): boolean {
    if (!message.orderId) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_order_id' });
      this.logger.error('Missing orderId in payment message');
      return false;
    }

    if (!message.userId) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_user_id' });
      this.logger.error('Missing userId in payment message');
      return false;
    }

    if (!uuid.safeParse(message.orderId).success) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_order_id' });
      this.logger.error('Invalid orderId in payment message');
      return false;
    }

    if (!uuid.safeParse(message.userId).success) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_user_id' });
      this.logger.error('Invalid userId in payment message');
      return false;
    }

    if (
      !isMoney(message.amount) ||
      message.amount <= 0 ||
      toCents(message.amount) > MAX_MONEY_CENTS
    ) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_amount' });
      this.logger.error('Invalid amount in payment message');
      return false;
    }

    if (!message.paymentMethod) {
      metrics.payment_orders_rejected.add(1, {
        reason: 'missing_payment_method',
      });
      this.logger.error('Missing paymentMethod in payment message');
      return false;
    }

    if (!KNOWN_PAYMENT_METHODS.has(message.paymentMethod)) {
      metrics.payment_orders_rejected.add(1, {
        reason: 'unknown_payment_method',
      });
      this.logger.error('Unknown paymentMethod in payment message');
      return false;
    }

    if (!message.items || message.items.length === 0) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_items' });
      this.logger.error('No items in payment message');
      return false;
    }

    if (!message.items.every(isValidItem)) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_item' });
      this.logger.error('Invalid item in payment message');
      return false;
    }

    // An absent discount is left to the total check below, which refuses it.
    if (
      message.discount !== undefined &&
      (!isMoney(message.discount) || message.discount < 0)
    ) {
      metrics.payment_orders_rejected.add(1, { reason: 'invalid_discount' });
      this.logger.error('Invalid discount in payment message');
      return false;
    }

    // In whole cents: 19.9 * 3 is 59.699999999999996 as a float, and the
    // checkout publishes 59.7.
    const itemsCents = message.items.reduce(
      (acc, item) => acc + toCents(item.price) * item.quantity,
      0
    );

    const expectedCents = itemsCents - toCents(message.discount);

    if (toCents(message.amount) !== expectedCents) {
      metrics.payment_orders_rejected.add(1, { reason: 'amount_mismatch' });
      this.logger.error('Payment amount does not match order total');
      return false;
    }

    return true;
  }
}
