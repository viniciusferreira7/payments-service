import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  deleteBrokerTopology,
  makeBrokerTopology,
} from 'test/events/broker-topology';
import { makeEnvService } from 'test/factories/make-env-service';
import { makeBrokerModuleRef, startApp } from 'test/factories/make-module-ref';
import { makePaymentOrder } from 'test/factories/make-payment-order';
import { EnvService } from '@/env/env.service';
import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { waitForConnection } from '@/utils/wait-for-connection';

describe('DlqController (e2e)', () => {
  const topology = makeBrokerTopology();

  let app: INestApplication;
  let rabbitmq: RabbitmqService;

  function validOrder(orderId: string): PaymentOrderMessage {
    return makePaymentOrder({ orderId });
  }

  function rejectedOrder(orderId: string): PaymentOrderMessage {
    return makePaymentOrder({ orderId, amount: 999 });
  }

  async function messageCount(queue: string): Promise<number> {
    const { messageCount } = await rabbitmq.getChannel().checkQueue(queue);

    return messageCount;
  }

  async function waitUntil(
    description: string,
    predicate: () => Promise<boolean>
  ): Promise<void> {
    const settled = await waitForConnection({
      maxAttempt: 50,
      delayMs: 100,
      callback: predicate,
    });

    if (!settled) {
      throw new Error(`Timed out waiting until ${description}`);
    }
  }

  async function publishOrder(order: PaymentOrderMessage): Promise<void> {
    await rabbitmq.publicMessage({
      exchange: topology.exchange,
      routingKey: topology.routingKey,
      message: order,
    });
  }

  async function deadLetter(...orders: PaymentOrderMessage[]): Promise<void> {
    for (const order of orders) {
      rabbitmq
        .getChannel()
        .publish(
          topology.dlxExchange,
          topology.dlqRoutingKey,
          Buffer.from(JSON.stringify(order)),
          { persistent: true, contentType: 'application/json' }
        );
    }

    await waitUntil(
      `${orders.length} message(s) reach the dead letter queue`,
      async () => (await messageCount(topology.dlq)) === orders.length
    );
  }

  function peek() {
    return request(app.getHttpServer()).get('/dlq/messages');
  }

  beforeAll(async () => {
    const moduleRef = await makeBrokerModuleRef((builder) =>
      builder.overrideProvider(EnvService).useValue(
        makeEnvService({
          RABBITMQ_QUEUE_PAYMENTS: topology.queue,
          RABBITMQ_EXCHANGE: topology.exchange,
          RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: topology.routingKey,
        })
      )
    );

    app = await startApp(moduleRef);
    rabbitmq = app.get(RabbitmqService);

    await waitUntil('the payments queue is declared', async () => {
      try {
        await messageCount(topology.dlq);
        return true;
      } catch {
        return false;
      }
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteBrokerTopology(process.env.RABBITMQ_URL as string, topology);
  });

  beforeEach(async () => {
    await rabbitmq.getChannel().purgeQueue(topology.queue);
    await rabbitmq.getChannel().purgeQueue(topology.dlq);
  });

  it('exposes an order the consumer rejected, with why the broker dead lettered it', async () => {
    await publishOrder(rejectedOrder('order-rejected'));

    await waitUntil(
      'the rejected order reaches the dead letter queue',
      async () => (await messageCount(topology.dlq)) === 1
    );

    const stats = await request(app.getHttpServer())
      .get('/dlq/stats')
      .expect(200);

    expect(stats.body).toEqual({
      queueName: topology.dlq,
      messageCount: 1,
      consumerCount: 0,
    });

    const { body } = await peek().expect(200);

    expect(body.count).toBe(1);
    expect(body.messages[0].content.orderId).toBe('order-rejected');
    expect(body.messages[0].deathInfo).toMatchObject({
      reason: 'rejected',
      queue: topology.queue,
      exchange: topology.exchange,
      count: 1,
    });
  });

  it('leaves the messages it peeked at on the queue', async () => {
    await deadLetter(validOrder('order-1'), validOrder('order-2'));

    const { body } = await peek().expect(200);

    expect(body.count).toBe(2);

    await waitUntil(
      'both messages are back on the dead letter queue',
      async () => (await messageCount(topology.dlq)) === 2
    );
  });

  it('honours the limit query parameter', async () => {
    await deadLetter(validOrder('order-1'), validOrder('order-2'));

    const { body } = await peek().query({ limit: '1' }).expect(200);

    expect(body.count).toBe(1);
  });

  it('reprocesses an order the consumer then accepts', async () => {
    await deadLetter(validOrder('order-ok'));

    const { body } = await request(app.getHttpServer())
      .post('/dlq/reprocess/order-ok')
      .expect(201);

    expect(body).toEqual({
      success: true,
      message: 'Message order-ok sent back to main queue for reprocessing',
    });

    await waitUntil(
      'the consumer has taken the order off the payments queue',
      async () =>
        (await messageCount(topology.dlq)) === 0 &&
        (await messageCount(topology.queue)) === 0
    );
  });

  it('dead letters a reprocessed order the consumer rejects again', async () => {
    await deadLetter(rejectedOrder('order-rejected'));

    await request(app.getHttpServer())
      .post('/dlq/reprocess/order-rejected')
      .expect(201);

    await waitUntil('the order comes back dead lettered', async () => {
      const { body } = await peek();

      return (
        body.count === 1 && body.messages[0].deathInfo?.reason === 'rejected'
      );
    });
  });

  it('answers 404 when no message carries the order', async () => {
    await deadLetter(validOrder('order-1'));

    await request(app.getHttpServer())
      .post('/dlq/reprocess/order-404')
      .expect(404);

    expect(await messageCount(topology.dlq)).toBe(1);
  });

  it('reprocesses every message on the queue', async () => {
    await deadLetter(validOrder('order-1'), validOrder('order-2'));

    const { body } = await request(app.getHttpServer())
      .post('/dlq/reprocess-all')
      .expect(201);

    expect(body).toEqual({ success: true, processed: 2, failed: 0 });

    await waitUntil(
      'both orders are consumed off the payments queue',
      async () =>
        (await messageCount(topology.dlq)) === 0 &&
        (await messageCount(topology.queue)) === 0
    );
  });

  it('discards a single message and leaves the rest', async () => {
    await deadLetter(validOrder('order-1'), validOrder('order-2'));

    const { body } = await request(app.getHttpServer())
      .delete('/dlq/message/order-1')
      .expect(200);

    expect(body).toEqual({
      success: true,
      message: 'Message with order-1 was successfully discard from DLQ',
    });

    await waitUntil(
      'only the untouched order is left',
      async () => (await messageCount(topology.dlq)) === 1
    );

    const remaining = await peek().expect(200);

    expect(remaining.body.messages[0].content.orderId).toBe('order-2');
  });

  it('answers 404 when discarding an order the queue does not hold', async () => {
    await deadLetter(validOrder('order-1'));

    await request(app.getHttpServer())
      .delete('/dlq/message/order-404')
      .expect(404);

    expect(await messageCount(topology.dlq)).toBe(1);
  });

  it('purges the dead letter queue', async () => {
    await deadLetter(validOrder('order-1'), validOrder('order-2'));

    const { body } = await request(app.getHttpServer())
      .delete('/dlq/purge')
      .expect(200);

    expect(body).toEqual({ success: true, purgedCount: 2 });

    expect(await messageCount(topology.dlq)).toBe(0);
  });
});
