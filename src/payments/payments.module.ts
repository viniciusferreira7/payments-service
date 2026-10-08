import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import {
  FakePaymentGatewayService,
  PAYMENT_GATEWAY_DELAY,
  randomLatency,
} from './gateway/fake-payment-gateway.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  providers: [
    FakePaymentGatewayService,
    { provide: PAYMENT_GATEWAY_DELAY, useValue: randomLatency },
  ],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
