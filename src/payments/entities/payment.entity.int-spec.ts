import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { resetDatabase } from 'test/utils/reset-database';
import { sqlStateOf } from 'test/utils/sql-state-of';
import type { Repository } from 'typeorm';
import { PaymentStatus } from '../enums/payment-status.enum';
import { Payment } from './payment.entity';

describe('Payment entity (integration)', () => {
  let app: INestApplication;
  let payments: Repository<Payment>;

  const row = (overrides: Partial<Payment> = {}) => ({
    orderId: randomUUID(),
    userId: randomUUID(),
    amount: 59.7,
    paymentMethod: 'pix',
    ...overrides,
  });

  beforeAll(async () => {
    app = await startApp(await makeModuleRef());
    payments = (await resetDatabase(app)).getRepository(Payment);
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to pending with no transaction, reason or processing time, and reads the amount as a number', async () => {
    const saved = await payments.save(payments.create(row()));
    const read = await payments.findOneByOrFail({ id: saved.id });

    expect(read).toMatchObject({
      amount: 59.7,
      status: PaymentStatus.PENDING,
      transactionId: null,
      rejectionReason: null,
      processedAt: null,
    });
  });

  it('allows one payment per order', async () => {
    const orderId = randomUUID();
    await payments.insert(row({ orderId }));

    expect(await sqlStateOf(payments.insert(row({ orderId })))).toBe('23505');
  });

  it.each([0, -1])('refuses an amount of %s', async (amount) => {
    expect(await sqlStateOf(payments.insert(row({ amount })))).toBe('23514');
  });
});
