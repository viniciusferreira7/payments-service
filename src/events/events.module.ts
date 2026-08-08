import { Module } from '@nestjs/common';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  providers: [RabbitmqService, PaymentQueueService],
  exports: [PaymentQueueService],
})
export class EventsModule {}
