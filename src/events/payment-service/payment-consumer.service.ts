import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { metrics } from '@/observability/metrics';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';

@Injectable()
export class PaymentConsumerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentConsumerService.name);

  constructor(private readonly paymentQueueService: PaymentQueueService) {}

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

      //TODO: Implement payment service

      this.logger.log('Payment order received and validated');
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

    if (!message.amount || message.amount <= 0) {
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

    if (!message.items || message.items.length === 0) {
      metrics.payment_orders_rejected.add(1, { reason: 'missing_items' });
      this.logger.error('No items in payment message');
      return false;
    }

    const itemsTotal = message.items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0
    );

    const expectedAmount = itemsTotal - message.discount;

    if (message.amount !== expectedAmount) {
      metrics.payment_orders_rejected.add(1, { reason: 'amount_mismatch' });
      this.logger.error('Payment amount does not match order total');
      return false;
    }

    return true;
  }
}
