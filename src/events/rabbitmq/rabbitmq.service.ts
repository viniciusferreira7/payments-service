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
  }: SubscribeToQueue): Promise<void> {
    try {
      if (!this.channel) {
        throw new Error('RabbitMQ channel not available');
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });

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

      const queue = await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86_400_000, // 24 hours
          'x-max-length': 10_000, // 10 thousand seconds
          'x-dead-letter-exchange': dlxExchangeName,
          'x-dead-letter-routing-key': routingKeyDlq,
        },
      });

      await this.channel.bindQueue(queue.queue, exchange, routingKey);

      await this.channel.prefetch(1);

      await this.channel.consume(queue.queue, async (msm) => {
        if (!msm) {
          this.logger.warn(`Consumer for queue ${queueName} was cancelled`);
          return;
        }

        try {
          const payload = JSON.parse(msm.content.toString('utf-8'));

          this.logger.log(`Message received from queue: ${queueName}`);
          this.logger.debug(`Message content: ${JSON.stringify(payload)}`);

          await callback(payload);

          this.channel.ack(msm);
          this.logger.log(
            `Message processed successfully from queue: ${queueName}`
          );
        } catch (error) {
          const errorDetails = getErrorDetails(error);
          this.logger.error(
            `Error to processing message: ${errorDetails.message}`,
            errorDetails.stack
          );

          this.channel.nack(msm, false, false);
          this.logger.warn(`This message sent to DLQ: ${dlqName}`);
        }
      });

      this.logger.log(
        `Subscribed to queue: ${queueName} with routing key: ${routingKey}`
      );
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
