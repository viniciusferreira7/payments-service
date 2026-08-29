import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';
import type {
  DLQMessage,
  DLQMessageDeathInfo,
} from '../interfaces/dlq-message.interface';
import type { DLQStats } from '../interfaces/dlq-stats.interface';

export class DlqStatsResponseDto implements DLQStats {
  @ApiProperty({
    description: 'Name of the dead letter queue being inspected',
    example: 'payments.dlq',
  })
  queueName: string;

  @ApiProperty({
    description: 'Messages currently waiting in the dead letter queue',
    example: 3,
  })
  messageCount: number;

  @ApiProperty({
    description: 'Consumers currently attached to the dead letter queue',
    example: 0,
  })
  consumerCount: number;
}

export class PaymentOrderItemDto {
  @ApiProperty({ example: '9f1c3d0e-2a5b-4a0e-9c47-2f0b1c9c3a11' })
  productId: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ description: 'Unit price in cents', example: 4990 })
  price: number;
}

export class PaymentOrderMessageDto implements PaymentOrderMessage {
  @ApiProperty({ example: 'b1d4f8a2-7c31-4c8e-9a2f-6d0b5e7c1a44' })
  orderId: string;

  @ApiProperty({ example: 'c7a9e5b1-3f62-4d18-8b77-1e2a9c4f6d33' })
  userId: string;

  @ApiProperty({ description: 'Total amount in cents', example: 9980 })
  amount: number;

  @ApiProperty({ description: 'Discount in cents', example: 0 })
  discount: number;

  @ApiProperty({ type: [PaymentOrderItemDto] })
  items: PaymentOrderItemDto[];

  @ApiProperty({ example: 'credit_card' })
  paymentMethod: string;

  @ApiPropertyOptional({ example: 'Order #1042' })
  description?: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-29T12:34:56.000Z' })
  createdAt: Date;
}

export class DlqMessagePropertiesDto {
  @ApiPropertyOptional({ example: 'b1d4f8a2-7c31-4c8e-9a2f-6d0b5e7c1a44' })
  messageId?: string;

  @ApiPropertyOptional({
    description: 'Publish time, in milliseconds since the epoch',
    example: 1756472096000,
  })
  timestamp?: number;

  @ApiPropertyOptional({
    description: 'AMQP headers carried by the message',
    type: 'object',
    additionalProperties: true,
  })
  headers?: Record<string, unknown>;
}

export class DlqMessageDeathInfoDto implements DLQMessageDeathInfo {
  @ApiProperty({
    description: 'Why the broker dead lettered the message',
    example: 'rejected',
  })
  reason: string;

  @ApiProperty({
    description: 'Queue the message was rejected from',
    example: 'payments.queue',
  })
  queue: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-29T12:35:10.000Z' })
  time: Date;

  @ApiProperty({
    description: 'How many times the message was dead lettered',
    example: 1,
  })
  count: number;

  @ApiProperty({ example: 'payments.exchange' })
  exchange: string;

  @ApiProperty({ type: [String], example: ['payment.order'] })
  routingKeys: string[];
}

export class DlqMessageDto implements DLQMessage {
  @ApiProperty({ type: PaymentOrderMessageDto })
  content: PaymentOrderMessageDto;

  @ApiProperty({ type: DlqMessagePropertiesDto })
  properties: DlqMessagePropertiesDto;

  @ApiPropertyOptional({ type: DlqMessageDeathInfoDto })
  deathInfo?: DlqMessageDeathInfoDto;
}

export class DlqMessagesResponseDto {
  @ApiProperty({
    description: 'How many messages this response carries',
    example: 2,
  })
  count: number;

  @ApiProperty({ type: [DlqMessageDto] })
  messages: DlqMessageDto[];
}

export class DlqMessageActionResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example:
      'Message b1d4f8a2-7c31-4c8e-9a2f-6d0b5e7c1a44 sent back to main queue for reprocessing',
  })
  message: string;
}

export class DlqReprocessAllResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description: 'Messages republished to the main queue',
    example: 5,
  })
  processed: number;

  @ApiProperty({
    description: 'Messages that could not be republished',
    example: 0,
  })
  failed: number;
}

export class DlqPurgeResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    description: 'Messages dropped from the dead letter queue',
    example: 12,
  })
  purgedCount: number;
}
