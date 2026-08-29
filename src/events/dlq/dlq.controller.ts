import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Query,
} from '@nestjs/common';
import { getErrorDetails } from '@/utils/error.util';
import { DlqService } from './dlq.service';
import type { DLQMessage } from './interfaces/dlq-message.interface';
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

  @Get('/messages')
  public async getMessages(
    @Query('limit') limit?: string
  ): Promise<{ count: number; messages: DLQMessage[] }> {
    try {
      const parsedLimit = limit ? parseInt(limit, 10) : 10;

      const messages = await this.dlqService.peekMessages(
        Math.abs(parsedLimit)
      );

      return {
        count: messages.length,
        messages,
      };
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to get DLQ messages: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        'Failed to get DLQ stats'
      );
    }
  }
}
