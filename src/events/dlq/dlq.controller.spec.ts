import { Test, TestingModule } from '@nestjs/testing';
import { DlqController } from './dlq.controller';

describe('DlqController', () => {
  let controller: DlqController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DlqController],
    }).compile();

    controller = module.get<DlqController>(DlqController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
