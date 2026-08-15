import { Module } from '@nestjs/common';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import { PaymentServiceService } from './payment-service/payment-service.service';

@Module({
  providers: [RabbitmqService, PaymentQueueService, PaymentServiceService],
  exports: [PaymentQueueService],
})
export class EventsModule {}
