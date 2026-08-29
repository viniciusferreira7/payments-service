import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { getErrorDetails } from '@/utils/error.util';
import { DlqService } from './dlq.service';
import type { DLQStats } from './interfaces/dlq-stats.interface';

@Controller('dlq')
export class DlqController {
  private readonly logger = new Logger(DlqController.name);

  constructor(private readonly dlqService: DlqService) {}

  @Get('/stats')
  public async getStats(): Promise<DLQStats> {
    try {
      return this.dlqService.getStats();
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to get DLQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        'Failed to get DLQ stats'
      );
    }
  }
}
