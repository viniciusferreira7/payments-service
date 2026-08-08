import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EnvService } from '@/env/env.service';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type { MetadataMessage } from './metadata-message.interface';

/**
 * Incoming shape on the payments queue: the checkout service enriches the
 * order with its own `metadata` block before publishing.
 */
export interface IncomingPaymentOrderMessage extends PaymentOrderMessage {
  metadata?: MetadataMessage;
}

/**
 * Consumer end of `payment.order`. The checkout service publishes to the
 * `payments` topic exchange; this service owns the queue bound to it and turns
 * each delivery into a payment to process.
 *
 * Throwing from `handlePaymentOrder` is meaningful: `RabbitmqService` nacks
 * without requeue on a rejected callback, so an invalid message is dropped
 * rather than looping forever. Valid-but-failed processing should be retried
 * through a DLQ once one exists.
 */
@Injectable()
export class PaymentQueueService implements OnModuleInit {
  private readonly logger = new Logger(PaymentQueueService.name);

  constructor(
    private readonly rabbitMqService: RabbitmqService,
    private readonly envService: EnvService
  ) {}

  async onModuleInit() {
    await this.subscribe();
  }

  private async subscribe() {
    const queueName = this.envService.get('RABBITMQ_QUEUE_PAYMENTS');
    const exchange = this.envService.get('RABBITMQ_EXCHANGE');
    const routingKey = this.envService.get(
      'RABBITMQ_ROUTING_KEY_PAYMENT_ORDER'
    );

    if (!this.rabbitMqService.getChannel()) {
      this.logger.warn(
        'RabbitMQ channel not available, skipping payment queue subscription'
      );

      return;
    }

    await this.rabbitMqService.subscribeToQueue({
      queueName,
      exchange,
      routingKey,
      callback: (message) =>
        this.handlePaymentOrder(message as IncomingPaymentOrderMessage),
    });
  }

  public async handlePaymentOrder(
    paymentOrder: IncomingPaymentOrderMessage
  ): Promise<void> {
    this.validatePaymentOrder(paymentOrder);

    this.logger.log(
      `Processing payment order: [ORDER ID]: ${paymentOrder.orderId}, [AMOUNT]: ${paymentOrder.amount}, [USER ID]: ${paymentOrder.userId}`
    );

    if (paymentOrder.metadata) {
      this.logger.debug(
        `Produced by ${paymentOrder.metadata.name}@${paymentOrder.metadata.version} at ${paymentOrder.metadata.timestamp}`
      );
    }

    try {
      // TODO: charge the payment provider, persist the payment and publish the
      // resulting `payment.approved` / `payment.declined` event.
      await this.processPayment(paymentOrder);

      this.logger.log(
        `Payment order processed successfully: ${paymentOrder.orderId}`
      );
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Error processing payment order ${paymentOrder.orderId}: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw error;
    }
  }

  private async processPayment(
    _paymentOrder: IncomingPaymentOrderMessage
  ): Promise<void> {
    await Promise.resolve();
  }

  private validatePaymentOrder(
    paymentOrder: IncomingPaymentOrderMessage
  ): void {
    if (!paymentOrder?.orderId) {
      throw new Error('Invalid payment order: missing orderId');
    }

    if (!paymentOrder.userId) {
      throw new Error('Invalid payment order: missing userId');
    }

    if (!paymentOrder.amount || paymentOrder.amount <= 0) {
      throw new Error('Invalid payment order: invalid amount');
    }

    if (!paymentOrder.items || paymentOrder.items.length === 0) {
      throw new Error('Invalid payment order: no items');
    }
  }
}
