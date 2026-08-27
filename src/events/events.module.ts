import { Module } from '@nestjs/common';
import { DlqController } from './dlq/dlq.controller';
import { DlqService } from './dlq/dlq.service';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { PaymentConsumerService } from './payment-service/payment-consumer.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  controllers: [DlqController],
  providers: [
    RabbitmqService,
    PaymentQueueService,
    PaymentConsumerService,
    DlqService,
  ],
  exports: [PaymentQueueService],
})
export class EventsModule {}
