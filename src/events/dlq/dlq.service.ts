import { Injectable, Logger } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { EnvService } from '@/env/env.service';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import type {
  DLQMessage,
  DLQMessageDeathInfo,
} from './interfaces/dlq-message.interface';
import type { DLQStats } from './interfaces/dlq-stats.interface';

@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);
  private readonly DLQ_NAME: string;
  private readonly EXCHANGE: string;
  private readonly ROUTING_KEY: string;

  constructor(
    private readonly rabbitMqService: RabbitmqService,
    private readonly envService: EnvService
  ) {
    this.DLQ_NAME = `${this.envService.get('RABBITMQ_QUEUE_PAYMENTS')}.dlq`;
    this.EXCHANGE = `${this.envService.get('RABBITMQ_EXCHANGE')}`;
    this.ROUTING_KEY = `${this.envService.get('RABBITMQ_ROUTING_KEY_PAYMENT_ORDER')}`;
  }

  private async getChannel(): Promise<Channel> {
    const channel = this.rabbitMqService.getChannel();

    if (!channel) {
      throw new Error('RabbitMQ channel not available');
    }

    return channel;
  }

  public async getStats(): Promise<DLQStats> {
    const channel = await this.getChannel();

    const queueInfo = await channel.checkQueue(this.DLQ_NAME);

    return {
      queueName: this.DLQ_NAME,
      messageCount: queueInfo.messageCount,
      consumerCount: queueInfo.consumerCount,
    };
  }

  public async peekMessages(limit: number = 10): Promise<DLQMessage[]> {
    const channel = await this.getChannel();

    const messages: DLQMessage[] = [];

    await channel.checkQueue(this.DLQ_NAME);

    for (let i = 0; i < limit; i++) {
      const message = await channel.get(this.DLQ_NAME, {
        noAck: false,
      });

      if (!message) break;

      try {
        const content = JSON.parse(
          message.content.toString()
        ) as PaymentOrderMessage;

        const xDeath = message.properties.headers?.['x-death'] as
          | Array<
              Omit<DLQMessageDeathInfo, 'routingKeys' | 'time'> & {
                'routing-key': string;
                time: { getTime: () => number };
              }
            >
          | undefined;

        const deathInfo = xDeath?.[0]
          ? {
              reason: xDeath[0].reason,
              queue: xDeath[0].queue,
              time: new Date(xDeath[0].time?.getTime?.() || Date.now()),
              count: xDeath[0].count,
              exchange: xDeath[0].exchange,
              routingKeys: xDeath[0]['routing-keys'],
            }
          : undefined;

        const headers =
          message.properties.headers &&
          typeof message.properties.headers === 'object'
            ? (message.properties.headers as Record<string, unknown>)
            : undefined;

        messages.push({
          content,
          properties: {
            messageId: message.properties.messageId as string | undefined,
            timestamp: message.properties.timestamp as number | undefined,
            headers,
          },
          deathInfo,
        });
        channel.nack(message, false, true);
      } catch (error) {
        const errorDetails = getErrorDetails(error);

        channel.nack(message, false, true);
        this.logger.error(
          `Failed to parse DLQ message: ${errorDetails.message}`,
          errorDetails.stack
        );
      }
    }

    return messages;
  }

  public async reprocessMessage(orderId: string): Promise<boolean> {
    const channel = await this.getChannel();

    const stats = await this.getStats();

    let found = false;

    for (let i = 0; i < stats.messageCount; i++) {
      const message = await channel.get(this.DLQ_NAME, { noAck: false });

      if (!message) break;
      try {
        const content = JSON.parse(
          message.content.toString()
        ) as PaymentOrderMessage;

        if (content?.orderId === orderId) {
          found = true;
          await this.rabbitMqService.publicMessage({
            exchange: this.EXCHANGE,
            routingKey: this.ROUTING_KEY,
            message: content,
          });

          channel.ack(message);
        }
      } catch (error) {
        const errorDetails = getErrorDetails(error);

        channel.nack(message, false, true);

        this.logger.error(
          `Failed to process DLQ message: ${errorDetails.message}`,
          errorDetails.stack
        );
      }
    }

    return found;
  }

  public async reprocessAll(): Promise<{ processed: number; failed: number }> {
    const channel = await this.getChannel();

    const stats = await this.getStats();

    this.logger.log(`Reprocessing ${stats.messageCount} messages from DLQ`);

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < stats.messageCount; i++) {
      const message = await channel.get(this.DLQ_NAME, { noAck: false });

      if (!message) break;

      try {
        const content = JSON.parse(
          message.content.toString()
        ) as PaymentOrderMessage;

        await this.rabbitMqService.publicMessage({
          exchange: this.EXCHANGE,
          routingKey: this.ROUTING_KEY,
          message: content,
        });

        channel.ack(message);
        processed++;
      } catch (error) {
        const errorDetails = getErrorDetails(error);

        channel.nack(message, false, true);
        failed++;

        this.logger.error(
          `Failed to process DLQ message: ${errorDetails.message}`,
          errorDetails.stack
        );
      }
    }

    return { processed, failed };
  }
}
