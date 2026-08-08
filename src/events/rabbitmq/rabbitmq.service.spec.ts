import { Test, type TestingModule } from '@nestjs/testing';
import { EnvService } from '@/env/env.service';
import { RabbitmqService } from './rabbitmq.service';

describe('RabbitmqService', () => {
  let service: RabbitmqService;

  beforeEach(async () => {
    // `RabbitmqService` injects `EnvService`, so the container needs it to
    // resolve. `compile()` does not run `onModuleInit`, so no AMQP connection
    // is opened here — this stays a unit test with no broker.
    const envService = {
      get: vi.fn().mockReturnValue('amqp://test:test@localhost:5672'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitmqService,
        { provide: EnvService, useValue: envService },
      ],
    }).compile();

    service = module.get<RabbitmqService>(RabbitmqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
