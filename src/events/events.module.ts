import { Module } from '@nestjs/common';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { PaymentConsumerService } from './payment-service/payment-consumer-service.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  providers: [RabbitmqService, PaymentQueueService, PaymentConsumerService],
  exports: [PaymentQueueService],
})
export class EventsModule {}
