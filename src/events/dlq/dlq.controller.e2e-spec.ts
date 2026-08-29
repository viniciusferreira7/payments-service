import type { INestApplication } from '@nestjs/common';
import {
  type BrokerHarness,
  makeBrokerHarness,
} from 'test/events/broker-harness';
import {
  deleteBrokerTopology,
  makeBrokerTopology,
} from 'test/events/broker-topology';
import { makeDlqClient } from 'test/events/dlq-client';
import { makeEnvService } from 'test/factories/make-env-service';
import { makeBrokerModuleRef, startApp } from 'test/factories/make-module-ref';
import {
  makePaymentOrder,
  makeRejectedPaymentOrder,
} from 'test/factories/make-payment-order';
import { waitUntil } from 'test/utils/wait-until';
import { EnvService } from '@/env/env.service';

describe('DlqController (e2e)', () => {
  const topology = makeBrokerTopology();

  let app: INestApplication;
  let broker: BrokerHarness;
  let dlq: ReturnType<typeof makeDlqClient>;

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
    broker = makeBrokerHarness(app, topology);
    dlq = makeDlqClient(app);

    await broker.waitForTopology();
  });

  afterAll(async () => {
    await app.close();
    await deleteBrokerTopology(process.env.RABBITMQ_URL as string, topology);
  });

  beforeEach(async () => {
    await broker.purge();
  });

  it('exposes an order the consumer rejected, with why the broker dead lettered it', async () => {
    await broker.publishOrder(
      makeRejectedPaymentOrder({ orderId: 'order-rejected' })
    );

    await broker.waitForDeadLetterCount(1);

    const stats = await dlq.stats().expect(200);

    expect(stats.body).toEqual({
      queueName: topology.dlq,
      messageCount: 1,
      consumerCount: 0,
    });

    const { body } = await dlq.messages().expect(200);

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
    await broker.deadLetter(
      makePaymentOrder({ orderId: 'order-1' }),
      makePaymentOrder({ orderId: 'order-2' })
    );

    const { body } = await dlq.messages().expect(200);

    expect(body.count).toBe(2);

    await broker.waitForDeadLetterCount(2);
  });

  it('honours the limit query parameter', async () => {
    await broker.deadLetter(
      makePaymentOrder({ orderId: 'order-1' }),
      makePaymentOrder({ orderId: 'order-2' })
    );

    const { body } = await dlq.messages('1').expect(200);

    expect(body.count).toBe(1);
  });

  it('reprocesses an order the consumer then accepts', async () => {
    await broker.deadLetter(makePaymentOrder({ orderId: 'order-ok' }));

    const { body } = await dlq.reprocess('order-ok').expect(201);

    expect(body).toEqual({
      success: true,
      message: 'Message order-ok sent back to main queue for reprocessing',
    });

    await broker.waitForDrainedQueues();
  });

  it('dead letters a reprocessed order the consumer rejects again', async () => {
    await broker.deadLetter(
      makeRejectedPaymentOrder({ orderId: 'order-rejected' })
    );

    await dlq.reprocess('order-rejected').expect(201);

    await waitUntil('the order comes back dead lettered', async () => {
      const { body } = await dlq.messages();

      return (
        body.count === 1 && body.messages[0].deathInfo?.reason === 'rejected'
      );
    });
  });

  it('answers 404 when no message carries the order', async () => {
    await broker.deadLetter(makePaymentOrder({ orderId: 'order-1' }));

    await dlq.reprocess('order-404').expect(404);

    expect(await broker.messageCount()).toBe(1);
  });

  it('reprocesses every message on the queue', async () => {
    await broker.deadLetter(
      makePaymentOrder({ orderId: 'order-1' }),
      makePaymentOrder({ orderId: 'order-2' })
    );

    const { body } = await dlq.reprocessAll().expect(201);

    expect(body).toEqual({ success: true, processed: 2, failed: 0 });

    await broker.waitForDrainedQueues();
  });

  it('discards a single message and leaves the rest', async () => {
    await broker.deadLetter(
      makePaymentOrder({ orderId: 'order-1' }),
      makePaymentOrder({ orderId: 'order-2' })
    );

    const { body } = await dlq.discard('order-1').expect(200);

    expect(body).toEqual({
      success: true,
      message: 'Message with order-1 was successfully discard from DLQ',
    });

    await broker.waitForDeadLetterCount(1);

    const remaining = await dlq.messages().expect(200);

    expect(remaining.body.messages[0].content.orderId).toBe('order-2');
  });

  it('answers 404 when discarding an order the queue does not hold', async () => {
    await broker.deadLetter(makePaymentOrder({ orderId: 'order-1' }));

    await dlq.discard('order-404').expect(404);

    expect(await broker.messageCount()).toBe(1);
  });

  it('purges the dead letter queue', async () => {
    await broker.deadLetter(
      makePaymentOrder({ orderId: 'order-1' }),
      makePaymentOrder({ orderId: 'order-2' })
    );

    const { body } = await dlq.purge().expect(200);

    expect(body).toEqual({ success: true, purgedCount: 2 });

    expect(await broker.messageCount()).toBe(0);
  });
});
