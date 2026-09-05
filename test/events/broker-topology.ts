import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';

export interface BrokerTopology {
  exchange: string;
  dlxExchange: string;
  retryExchange: string;
  queue: string;
  dlq: string;
  retryQueue: string;
  routingKey: string;
  dlqRoutingKey: string;
  retryRoutingKey: string;
}

export function makeBrokerTopology(prefix = 'e2e'): BrokerTopology {
  const id = randomUUID().slice(0, 8);

  const exchange = `${prefix}.payments.${id}`;
  const queue = `${prefix}.payment_queue.${id}`;
  const routingKey = 'payment.order';

  return {
    exchange,
    dlxExchange: `${exchange}.dlx`,
    retryExchange: `${exchange}.retry.dlx`,
    queue,
    dlq: `${queue}.dlq`,
    retryQueue: `${queue}.retry`,
    routingKey,
    dlqRoutingKey: `${routingKey}.dlq`,
    retryRoutingKey: `${routingKey}.retry`,
  };
}

export async function deleteBrokerTopology(
  url: string,
  topology: BrokerTopology
): Promise<void> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  await channel.deleteQueue(topology.queue);
  await channel.deleteQueue(topology.dlq);
  await channel.deleteQueue(topology.retryQueue);
  await channel.deleteExchange(topology.exchange);
  await channel.deleteExchange(topology.dlxExchange);
  await channel.deleteExchange(topology.retryExchange);

  await channel.close();
  await connection.close();
}
