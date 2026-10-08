import { Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../enums/payment-status.enum';
import { PaymentResponseDto } from './payment-response.dto';

describe('PaymentResponseDto', () => {
  it('exposes the payment without its owner', () => {
    const processedAt = new Date('2026-10-08T12:00:00.000Z');
    const createdAt = new Date('2026-10-08T11:59:58.000Z');
    const payment = Object.assign(new Payment(), {
      id: 'p',
      orderId: 'o',
      userId: 'u',
      amount: 300,
      status: PaymentStatus.APPROVED,
      paymentMethod: 'pix',
      transactionId: 'fake_x',
      rejectionReason: null,
      processedAt,
      createdAt,
      updatedAt: processedAt,
    });

    expect({ ...PaymentResponseDto.from(payment) }).toEqual({
      id: 'p',
      orderId: 'o',
      amount: 300,
      status: 'approved',
      paymentMethod: 'pix',
      transactionId: 'fake_x',
      rejectionReason: null,
      processedAt,
      createdAt,
    });
  });
});
