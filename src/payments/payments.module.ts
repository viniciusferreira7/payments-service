import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import {
  FakePaymentGatewayService,
  PAYMENT_GATEWAY_DELAY,
  randomLatency,
} from './gateway/fake-payment-gateway.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [PaymentsController],
  providers: [
    FakePaymentGatewayService,
    PaymentsService,
    { provide: PAYMENT_GATEWAY_DELAY, useValue: randomLatency },
  ],
  exports: [TypeOrmModule, PaymentsService],
})
export class PaymentsModule {}
