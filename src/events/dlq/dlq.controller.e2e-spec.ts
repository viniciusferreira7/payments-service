import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  type DlqDelivery,
  makeDlqChannel,
  makeDlqDelivery,
  orderIdsIn,
} from 'test/events/fake-dlq-channel';
import { FakeRabbitmqService } from 'test/events/fake-rabbitmq-service';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { makePaymentOrder } from 'test/factories/make-payment-order';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';

/**
 * A fake broker whose channel is the dead letter double from
 * `test/events/fake-dlq-channel`, so the HTTP endpoints act on a queue that
 * behaves like the real one: `get` hands out the head, `ack` drops it and a
 * requeueing `nack` puts it back at the head.
 */
class DlqRabbitmqService extends FakeRabbitmqService {
  readonly dlq = makeDlqChannel();

  getChannel() {
    return this.dlq as unknown as ReturnType<RabbitmqService['getChannel']>;
  }
}

describe('DlqController (e2e)', () => {
  let app: INestApplication;
  let rabbitmq: DlqRabbitmqService;

  /** The queue name `DlqService` derives from `RABBITMQ_QUEUE_PAYMENTS`. */
  const DLQ_NAME = 'payment_queue.dlq';

  function seed(...deliveries: DlqDelivery[]): void {
    rabbitmq.dlq.queue.push(...deliveries);
  }

  beforeEach(async () => {
    rabbitmq = new DlqRabbitmqService();

    const moduleRef = await makeModuleRef((builder) =>
      builder.overrideProvider(RabbitmqService).useValue(rabbitmq)
    );

    app = await startApp(moduleRef);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /dlq/stats', () => {
    it('reports what the dead letter queue holds', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .get('/dlq/stats')
        .expect(200);

      expect(response.body).toEqual({
        queueName: DLQ_NAME,
        messageCount: 2,
        consumerCount: 0,
      });
    });

    it('reports an empty queue', async () => {
      const response = await request(app.getHttpServer())
        .get('/dlq/stats')
        .expect(200);

      expect(response.body.messageCount).toBe(0);
    });
  });

  describe('GET /dlq/messages', () => {
    it('returns the messages without consuming them', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .get('/dlq/messages')
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(
        response.body.messages.map(
          (message: { content: { orderId: string } }) => message.content.orderId
        )
      ).toEqual(['order-1', 'order-2']);

      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-1', 'order-2']);
    });

    it('honours the limit query parameter', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .get('/dlq/messages')
        .query({ limit: '1' })
        .expect(200);

      expect(response.body.count).toBe(1);
      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-1', 'order-2']);
    });
  });

  describe('POST /dlq/reprocess/:orderId', () => {
    it('republishes the matching message to the main queue', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .post('/dlq/reprocess/order-2')
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        message: 'Message order-2 sent back to main queue for reprocessing',
      });

      expect(rabbitmq.published).toHaveLength(1);
      expect(rabbitmq.published[0]).toMatchObject({
        exchange: 'payments',
        routingKey: 'payment.order',
        message: expect.objectContaining({ orderId: 'order-2' }),
      });

      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-1']);
    });

    it('answers 404 when no message carries the order', async () => {
      seed(makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })));

      await request(app.getHttpServer())
        .post('/dlq/reprocess/order-404')
        .expect(404);

      expect(rabbitmq.published).toHaveLength(0);
      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-1']);
    });
  });

  describe('POST /dlq/reprocess-all', () => {
    it('drains the queue back into the main queue', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .post('/dlq/reprocess-all')
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        processed: 2,
        failed: 0,
      });

      expect(rabbitmq.published).toHaveLength(2);
      expect(rabbitmq.dlq.queue).toHaveLength(0);
    });

    it('keeps the messages it cannot read', async () => {
      seed(
        makeDlqDelivery('not json'),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .post('/dlq/reprocess-all')
        .expect(201);

      expect(response.body).toEqual({
        success: true,
        processed: 1,
        failed: 1,
      });

      expect(rabbitmq.dlq.queue).toHaveLength(1);
    });
  });

  describe('DELETE /dlq/message/:orderId', () => {
    it('drops the matching message without republishing it', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .delete('/dlq/message/order-1')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Message with order-1 was successfully discard from DLQ',
      });

      expect(rabbitmq.published).toHaveLength(0);
      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-2']);
    });

    it('answers 404 when no message carries the order', async () => {
      seed(makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })));

      await request(app.getHttpServer())
        .delete('/dlq/message/order-404')
        .expect(404);

      expect(orderIdsIn(rabbitmq.dlq.queue)).toEqual(['order-1']);
    });
  });

  describe('DELETE /dlq/purge', () => {
    it('empties the dead letter queue', async () => {
      seed(
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-1' })),
        makeDlqDelivery(makePaymentOrder({ orderId: 'order-2' }))
      );

      const response = await request(app.getHttpServer())
        .delete('/dlq/purge')
        .expect(200);

      expect(response.body).toEqual({ success: true, purgedCount: 2 });
      expect(rabbitmq.dlq.queue).toHaveLength(0);
    });
  });
});
