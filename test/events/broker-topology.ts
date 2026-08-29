import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';

/**
 * The exchange, queue and routing key names a spec runs against, matching the
 * layout `RabbitmqService.subscribeToQueue` asserts: a topic exchange, a dead
 * letter exchange beside it, the payments queue, and the dead letter queue
 * bound to the dead letter exchange.
 */
export interface BrokerTopology {
  exchange: string;
  dlxExchange: string;
  queue: string;
  dlq: string;
  routingKey: string;
  dlqRoutingKey: string;
}

/**
 * Names a topology of its own for a spec, so a run against a real broker never
 * consumes from — or purges — the queues a developer is using.
 *
 * ```ts
 * const topology = makeBrokerTopology();
 *
 * builder.overrideProvider(EnvService).useValue(
 *   makeEnvService({
 *     RABBITMQ_QUEUE_PAYMENTS: topology.queue,
 *     RABBITMQ_EXCHANGE: topology.exchange,
 *   })
 * );
 * ```
 */
export function makeBrokerTopology(prefix = 'e2e'): BrokerTopology {
  const id = randomUUID().slice(0, 8);

  const exchange = `${prefix}.payments.${id}`;
  const queue = `${prefix}.payment_queue.${id}`;
  const routingKey = 'payment.order';

  return {
    exchange,
    dlxExchange: `${exchange}.dlx`,
    queue,
    dlq: `${queue}.dlq`,
    routingKey,
    dlqRoutingKey: `${routingKey}.dlq`,
  };
}

/**
 * Removes everything {@link makeBrokerTopology} named, on its own connection —
 * the application has already closed its channel by teardown time.
 */
export async function deleteBrokerTopology(
  url: string,
  topology: BrokerTopology
): Promise<void> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  await channel.deleteQueue(topology.queue);
  await channel.deleteQueue(topology.dlq);
  await channel.deleteExchange(topology.exchange);
  await channel.deleteExchange(topology.dlxExchange);

  await channel.close();
  await connection.close();
}
