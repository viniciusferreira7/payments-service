import { ApiProperty } from '@nestjs/swagger';
import type { Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../enums/payment-status.enum';

/** A payment as its owner sees it; `userId` never leaves the service. */
export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiProperty({ example: 300 })
  amount: number;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.APPROVED })
  status: PaymentStatus;

  @ApiProperty({ example: 'credit_card' })
  paymentMethod: string;

  @ApiProperty({ type: String, nullable: true, example: 'fake_…' })
  transactionId: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  rejectionReason: string | null;

  @ApiProperty({ type: Date, nullable: true })
  processedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  static from(payment: Payment): PaymentResponseDto {
    const dto = new PaymentResponseDto();

    dto.id = payment.id;
    dto.orderId = payment.orderId;
    dto.amount = payment.amount;
    dto.status = payment.status;
    dto.paymentMethod = payment.paymentMethod;
    dto.transactionId = payment.transactionId;
    dto.rejectionReason = payment.rejectionReason;
    dto.processedAt = payment.processedAt;
    dto.createdAt = payment.createdAt;

    return dto;
  }
}
