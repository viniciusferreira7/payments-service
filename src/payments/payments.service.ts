import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { toCents } from '@/common/money';
import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';
import { metrics } from '@/observability/metrics';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './enums/payment-status.enum';
import { FakePaymentGatewayService } from './gateway/fake-payment-gateway.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    private readonly gateway: FakePaymentGatewayService
  ) {}

  /**
   * Charges an order once, however many times its message is delivered: the
   * row is keyed by `order_id`, and it is locked (`FOR UPDATE`) while it is
   * charged, so a concurrent delivery of the same order waits, then finds it
   * no longer `pending` and charges nothing. A rejection is an outcome, not a
   * failure — it returns, so the message is acked. Anything unexpected rolls
   * back to `pending` and propagates to the retry/DLQ loop.
   */
  async processPayment(message: PaymentOrderMessage): Promise<Payment> {
    await this.payments
      .createQueryBuilder()
      .insert()
      .into(Payment)
      .values({
        orderId: message.orderId,
        userId: message.userId,
        amount: message.amount,
        paymentMethod: message.paymentMethod,
      })
      .orIgnore()
      .execute();

    return this.payments.manager.transaction(async (manager) => {
      const payment = await manager.findOneOrFail(Payment, {
        where: { orderId: message.orderId },
        lock: { mode: 'pessimistic_write' },
      });

      // The order id is the key, so a redelivery must say the same thing. One
      // that disagrees is not a duplicate: acking it would drop it silently.
      if (!PaymentsService.matches(payment, message)) {
        metrics.payment_orders_rejected.add(1, {
          reason: 'conflicting_redelivery',
        });
        this.logger.warn(
          `Payment order ${payment.orderId} conflicts with the stored payment`
        );

        throw new Error(
          `Payment order ${payment.orderId} conflicts with the stored payment`
        );
      }

      if (payment.status !== PaymentStatus.PENDING) {
        this.logger.log(
          `Payment for order ${payment.orderId} already processed`
        );

        return payment;
      }

      const result = await this.gateway.charge({
        orderId: payment.orderId,
        amount: payment.amount,
      });

      payment.status = result.approved
        ? PaymentStatus.APPROVED
        : PaymentStatus.REJECTED;
      payment.transactionId = result.transactionId;
      payment.rejectionReason = result.rejectionReason ?? null;
      payment.processedAt = new Date();

      return manager.save(payment);
    });
  }

  private static matches(
    payment: Payment,
    message: PaymentOrderMessage
  ): boolean {
    return (
      payment.userId === message.userId &&
      toCents(payment.amount) === toCents(message.amount) &&
      payment.paymentMethod === message.paymentMethod
    );
  }

  /** Another user's payment answers like a missing one: no hint it exists. */
  async findByOrderId(orderId: string, userId: string): Promise<Payment> {
    const payment = await this.payments.findOneBy({ orderId, userId });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }
}
