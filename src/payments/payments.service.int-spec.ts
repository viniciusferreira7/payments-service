import { randomUUID } from 'node:crypto';
import { type INestApplication, NotFoundException } from '@nestjs/common';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { makePaymentOrder } from 'test/factories/make-payment-order';
import { resetDatabase } from 'test/utils/reset-database';
import type { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './enums/payment-status.enum';
import {
  FakePaymentGatewayService,
  PAYMENT_GATEWAY_DELAY,
  REJECTION_REASONS,
} from './gateway/fake-payment-gateway.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService (integration)', () => {
  let app: INestApplication;
  let service: PaymentsService;
  let gateway: FakePaymentGatewayService;
  let payments: Repository<Payment>;

  const order = (amount: number) =>
    makePaymentOrder({
      orderId: randomUUID(),
      userId: randomUUID(),
      amount,
      items: [{ productId: randomUUID(), quantity: 1, price: amount }],
      paymentMethod: 'pix',
    });

  beforeAll(async () => {
    const moduleRef = await makeModuleRef((builder) =>
      builder
        .overrideProvider(PAYMENT_GATEWAY_DELAY)
        .useValue(() => Promise.resolve())
    );
    app = await startApp(moduleRef);
    payments = (await resetDatabase(app)).getRepository(Payment);
    service = app.get(PaymentsService);
    gateway = app.get(FakePaymentGatewayService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('processPayment', () => {
    it('approves 50.00 and records the transaction', async () => {
      const message = order(50);

      const payment = await service.processPayment(message);

      expect(payment).toMatchObject({
        orderId: message.orderId,
        userId: message.userId,
        amount: 50,
        paymentMethod: 'pix',
        status: PaymentStatus.APPROVED,
        transactionId: expect.stringMatching(/^fake_/),
        rejectionReason: null,
        processedAt: expect.any(Date),
      });
      expect(
        await payments.findOneByOrFail({ orderId: message.orderId })
      ).toMatchObject({ status: PaymentStatus.APPROVED });
    });

    it.each([
      [49.99, REJECTION_REASONS.CARD_DECLINED],
      [10000.01, REJECTION_REASONS.LIMIT_EXCEEDED],
    ])('rejects %s with its reason', async (amount, reason) => {
      const payment = await service.processPayment(order(amount));

      expect(payment).toMatchObject({
        status: PaymentStatus.REJECTED,
        rejectionReason: reason,
        transactionId: expect.stringMatching(/^fake_/),
        processedAt: expect.any(Date),
      });
    });

    it('charges a redelivered order once and keeps one row', async () => {
      const charge = vi.spyOn(gateway, 'charge');
      const message = order(50);

      const first = await service.processPayment(message);
      const second = await service.processPayment(message);

      expect(charge).toHaveBeenCalledTimes(1);
      expect(second.transactionId).toBe(first.transactionId);
      expect(await payments.countBy({ orderId: message.orderId })).toBe(1);
    });

    it('finishes a payment a previous attempt left pending', async () => {
      const message = order(50);
      await payments.insert({
        orderId: message.orderId,
        userId: message.userId,
        amount: 50,
        paymentMethod: 'pix',
      });

      const payment = await service.processPayment(message);

      expect(payment.status).toBe(PaymentStatus.APPROVED);
      expect(await payments.countBy({ orderId: message.orderId })).toBe(1);
    });

    it('leaves the payment pending and propagates when the gateway fails', async () => {
      const message = order(50);
      vi.spyOn(gateway, 'charge').mockRejectedValue(new Error('gateway down'));

      await expect(service.processPayment(message)).rejects.toThrow(
        'gateway down'
      );
      expect(
        await payments.findOneByOrFail({ orderId: message.orderId })
      ).toMatchObject({ status: PaymentStatus.PENDING, processedAt: null });
    });
  });

  describe('findByOrderId', () => {
    it("finds the user's payment", async () => {
      const message = order(50);
      await service.processPayment(message);

      const payment = await service.findByOrderId(
        message.orderId,
        message.userId
      );

      expect(payment.orderId).toBe(message.orderId);
    });

    it("answers 404 for another user's payment, as for a missing one", async () => {
      const message = order(50);
      await service.processPayment(message);

      await expect(
        service.findByOrderId(message.orderId, randomUUID())
      ).rejects.toThrow(new NotFoundException('Payment not found'));
      await expect(
        service.findByOrderId(randomUUID(), message.userId)
      ).rejects.toThrow(new NotFoundException('Payment not found'));
    });
  });
});
