import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { signTestToken } from 'test/factories/make-token';
import { resetDatabase } from 'test/utils/reset-database';
import type { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './enums/payment-status.enum';

describe('GET /payments/:orderId (E2E)', () => {
  let app: INestApplication;
  let payments: Repository<Payment>;

  const owner = randomUUID();
  const tokenOf = (userId: string) =>
    signTestToken(
      { sub: userId, email: 'ana@marketplace.dev', role: 'buyer' },
      { expiresIn: '1h' }
    );
  const getPayment = (orderId: string, userId?: string) => {
    const call = request(app.getHttpServer()).get(`/payments/${orderId}`);

    return userId
      ? call.set('Authorization', `Bearer ${tokenOf(userId)}`)
      : call;
  };

  beforeAll(async () => {
    app = await startApp(await makeModuleRef());
    payments = (await resetDatabase(app)).getRepository(Payment);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the owner with the processed payment, without userId', async () => {
    const orderId = randomUUID();
    await payments.insert({
      orderId,
      userId: owner,
      amount: 300,
      paymentMethod: 'credit_card',
      status: PaymentStatus.APPROVED,
      transactionId: 'fake_abc',
      processedAt: new Date(),
    });

    const response = await getPayment(orderId, owner).expect(200);

    expect(response.body).toEqual({
      id: expect.any(String),
      orderId,
      amount: 300,
      status: 'approved',
      paymentMethod: 'credit_card',
      transactionId: 'fake_abc',
      rejectionReason: null,
      processedAt: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it('answers 200 pending while the payment is being processed', async () => {
    const orderId = randomUUID();
    await payments.insert({
      orderId,
      userId: owner,
      amount: 49.99,
      paymentMethod: 'pix',
    });

    const response = await getPayment(orderId, owner).expect(200);

    expect(response.body).toMatchObject({
      status: 'pending',
      transactionId: null,
      processedAt: null,
    });
  });

  it('answers 404 to another user, exactly as for an order that has no payment', async () => {
    const orderId = randomUUID();
    await payments.insert({
      orderId,
      userId: owner,
      amount: 10,
      paymentMethod: 'pix',
    });

    const foreign = await getPayment(orderId, randomUUID()).expect(404);
    const missing = await getPayment(randomUUID(), owner).expect(404);

    expect(foreign.body.message).toBe('Payment not found');
    expect(missing.body).toEqual(foreign.body);
  });

  it('answers 400 for an order id that is not a UUID', async () => {
    await getPayment('abc', owner).expect(400);
  });

  it('answers 401 without a token', async () => {
    await getPayment(randomUUID()).expect(401);
  });
});
