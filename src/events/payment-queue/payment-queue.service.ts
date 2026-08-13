import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '@/env/env.service';
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

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);

  constructor(
    private readonly rabbitMqService: RabbitmqService,
    private readonly envService: EnvService
  ) {}

  public async consumePaymentOrders(
    callback: (message: unknown) => Promise<void>
  ) {
    this.logger.log('Setting up payment orders consumer');

    await this.rabbitMqService.subscribeToQueue({
      queueName: this.envService.get('RABBITMQ_QUEUE_PAYMENTS'),
      routingKey: this.envService.get('RABBITMQ_ROUTING_KEY_PAYMENT_ORDER'),
      exchange: this.envService.get('RABBITMQ_EXCHANGE'),
      callback,
    });

    this.logger.log('Payment orders consumer is ready');
  }
}
