import { Test, TestingModule } from '@nestjs/testing';
import { PaymentConsumerService } from './payment-consumer-service.service';

describe('PaymentConsumerService', () => {
  let service: PaymentConsumerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentConsumerService],
    }).compile();

    service = module.get<PaymentConsumerService>(PaymentConsumerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
