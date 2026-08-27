import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { DlqService } from './dlq.service';

const env: Record<string, string> = {
  RABBITMQ_QUEUE_PAYMENTS: 'payment_queue',
  RABBITMQ_EXCHANGE: 'payments',
  RABBITMQ_ROUTING_KEY_PAYMENT_ORDER: 'payment.order',
};

describe('DlqService', () => {
  let service: DlqService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DlqService,
        { provide: RabbitmqService, useValue: { getChannel: vi.fn() } },
        { provide: EnvService, useValue: { get: vi.fn((k) => env[k]) } },
      ],
    }).compile();

    service = module.get<DlqService>(DlqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
