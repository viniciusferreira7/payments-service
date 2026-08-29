import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';

export interface BrokerTopology {
  exchange: string;
  dlxExchange: string;
  queue: string;
  dlq: string;
  routingKey: string;
  dlqRoutingKey: string;
}

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
