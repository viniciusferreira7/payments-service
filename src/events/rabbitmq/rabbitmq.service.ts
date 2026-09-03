import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { EnvService } from '@/env/env.service';
import { getErrorDetails } from '@/utils/error.util';
import { waitForConnection } from '@/utils/wait-for-connection';
import type { PublicMessageParams } from '../interfaces/public-message.interface';
import type { SubscribeToQueue } from '../interfaces/subscribe-to-queue.interface';

type AssertRetryParams = Pick<
  SubscribeToQueue,
  'queueName' | 'exchange' | 'routingKey' | 'options'
>;

type AssertDlqParams = Pick<
  SubscribeToQueue,
  'queueName' | 'exchange' | 'routingKey'
>;

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(private readonly envService: EnvService) {}

  public getChannel(): amqp.Channel {
    return this.channel;
  }

  public getConnection(): amqp.ChannelModel {
    return this.connection;
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
  async onModuleInit() {
    const maxAttempt = 10;
    const isConnected = await waitForConnection({
      maxAttempt,
      callback: (attempt) => {
        this.logger.debug(
          `Waiting for RabbitMQ connection... (attempt ${attempt}/${maxAttempt})`
        );
        return this.connect();
      },
    });

    if (!isConnected) {
      this.logger.error('Gave up connecting to RabbitMQ: broker unreachable');
    }
  }

  private async connect(): Promise<boolean> {
    const rabbitMqUrl = this.envService.rabbitmqUrl;

    try {
      if (!this.connection) {
        this.connection = await amqp.connect(rabbitMqUrl);
        this.logger.log('Connected on RabbitmQ successfully');
      }
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      this.logger.error(
        `Failed to connect on RabbiMQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      return false;
    }

    try {
      this.channel = await this.connection.createChannel();
      this.logger.log('Created on RabbitmQ successfully');

      return true;
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to create channel on RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      return false;
    }
  }

  private async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.logger.log('RabbitMQ channel service was closed');
      }
      if (this.connection) {
        await this.connection.close();
        this.logger.log('RabbitMQ service was disconnected');
      }
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      this.logger.error(
        `Failed to disconnect from RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private async assertRetry({
    queueName,
    exchange,
    routingKey,
    options = { maxRetries: 3, retryDelayMs: 30_000 },
  }: AssertRetryParams): Promise<{
    retryQueueName: string;
    retryExchangeName: string;
    retryRoutingKey: string;
  }> {
    const retryExchangeName = `${exchange}.retry.dlx`;
    await this.channel.assertExchange(retryExchangeName, 'topic', {
      durable: true,
    });

    const retryQueueName = `${queueName}.retry`;

    await this.channel.assertQueue(retryQueueName, {
      durable: true,
      arguments: {
        'x-message-ttl': options?.retryDelayMs ?? 30_000,
        'x-dead-letter-exchange': exchange,
        'x-dead-letter-routing-key': routingKey,
      },
    });

    const retryRoutingKey = `${routingKey}.retry`;

    await this.channel.bindQueue(
      retryQueueName,
      retryExchangeName,
      retryRoutingKey
    );

    return {
      retryQueueName,
      retryExchangeName,
      retryRoutingKey,
    };
  }

  private async assertDlq({
    queueName,
    exchange,
    routingKey,
  }: AssertDlqParams): Promise<{
    dlqName: string;
    dlxExchangeName: string;
    routingKeyDlq: string;
  }> {
    const dlxExchangeName = `${exchange}.dlx`;
    await this.channel.assertExchange(dlxExchangeName, 'topic', {
      durable: true,
    });

    const dlqName = `${queueName}.dlq`;
    await this.channel.assertQueue(dlqName, {
      durable: true,
      arguments: {
        'x-message-tll': 604_800_000, // 7 days
      },
    });

    const routingKeyDlq = `${routingKey}.dlq`;

    await this.channel.bindQueue(dlqName, dlxExchangeName, routingKeyDlq);

    return {
      dlqName,
      dlxExchangeName,
      routingKeyDlq,
    };
  }

  private getRetryCount(msg: amqp.ConsumeMessage): number {
    const xDeath = msg?.properties?.headers?.['x-death'] as
      | Array<{ count: number; queue: string }>
      | undefined;

    if (!xDeath || xDeath.length === 0) return 0;

    const count = xDeath
      .filter((death) => !death.queue.endsWith('.retry'))
      .reduce((acc, death) => acc + (death.count || 0), 0);

    return count;
  }

  public async publicMessage({
    exchange,
    routingKey,
    message,
  }: PublicMessageParams): Promise<void> {
    try {
      if (!this.channel) {
        this.logger.warn(
          'RabbiMq channel not available, skipping message publish'
        );

        return;
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const publishedMessage = this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        }
      );

      if (!publishedMessage)
        throw new Error('Failed to publish message to RabbiMQ');

      this.logger.log(
        `Message was published to [EXCHANGE]: ${exchange} - [ROUTING KEY]: ${routingKey}`
      );
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
    } catch (error) {
      const errorDetails = getErrorDetails(error);
      this.logger.error(
        `Error publishing message to RabbitMQ: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  public async subscribeToQueue({
    queueName,
    exchange,
    routingKey,
    callback,
    options = { maxRetries: 3, retryDelayMs: 30_000 },
  }: SubscribeToQueue): Promise<void> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 30_000; // 30 seconds

    try {
      if (!this.channel) {
        throw new Error('RabbitMQ channel not available');
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });

      const retryInfo = await this.assertRetry({
        queueName,
        exchange,
        routingKey,
        options: { maxRetries, retryDelayMs },
      });

      const dlqInfo = await this.assertDlq({
        queueName,
        exchange,
        routingKey,
      });

      const queue = await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86_400_000, // 24 hours
          'x-max-length': 10_000, // 10 thousand seconds
          'x-dead-letter-exchange': retryInfo.retryExchangeName,
          'x-dead-letter-routing-key': retryInfo.retryRoutingKey,
        },
      });

      await this.channel.bindQueue(queue.queue, exchange, routingKey);

      await this.channel.prefetch(1);

      await this.channel.consume(queue.queue, async (msg) => {
        if (!msg) {
          this.logger.warn(`Consumer for queue ${queueName} was cancelled`);
          return;
        }

        const retryCount = this.getRetryCount(msg);

        this.logger.log(
          `Message received (attempt ${retryCount + 1}/${maxRetries ?? 3})`
        );

        try {
          const payload = JSON.parse(msg.content.toString('utf-8'));

          this.logger.log(`Message received from queue: ${queueName}`);
          this.logger.debug(`Message content: ${JSON.stringify(payload)}`);

          await callback(payload);

          this.channel.ack(msg);
          this.logger.log(
            `Message processed successfully from queue: ${queueName}`
          );
        } catch (error) {
          if (retryCount < maxRetries) {
            this.logger.warn(
              `Processing failed (attempt ${retryCount + 1}/${maxRetries + 1})` +
                `Retrying in ${retryDelayMs / 1_000}s`
            );

            this.channel.nack(msg, false, false);
          } else {
            this.logger.error(
              `Max retries (${maxRetries}) exceeded. Sending to DLQ.`
            );

            this.channel.publish(
              dlqInfo.dlxExchangeName,
              dlqInfo.routingKeyDlq,
              msg.content,
              { persistent: true, headers: msg.properties.headers }
            );

            this.channel.ack(msg);
          }

          const errorDetails = getErrorDetails(error);
          this.logger.error(
            `Error to processing message: ${errorDetails.message}`,
            errorDetails.stack
          );
        }
      });

      this.logger.log(
        `Retry queue: ${retryInfo.retryQueueName} (${retryDelayMs}ms delay)`
      );
      this.logger.log(`Subscribed to queue: ${queueName}`);
      this.logger.log(`Dead letter queue: ${dlqInfo.dlqName}`);
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Error subscribing to queue ${queueName}: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw error;
    }
  }
}
