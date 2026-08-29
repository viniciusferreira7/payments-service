import {
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
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
      const absLimit = Math.abs(parsedLimit);

      const messages = await this.dlqService.peekMessages(absLimit);

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

  @Post('/reprocess/:orderId')
  public async reprocessMessage(
    @Param('orderId') orderId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const messageFounded = await this.dlqService.reprocessMessage(orderId);

      if (!messageFounded) {
        this.logger.error(`Message with ${orderId} not found in DLQ`);

        throw new NotFoundException(`Message with ${orderId} not found in DLQ`);
      }

      return {
        success: messageFounded,
        message: `Message ${orderId} sent back to main queue for reprocessing`,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;

      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to reprocess message ${orderId}: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        `Failed to reprocess message ${orderId}: ${errorDetails.message}`
      );
    }
  }

  @Post('/reprocess-all')
  public async reprocessAll(): Promise<{
    success: boolean;
    processed: number;
    failed: number;
  }> {
    try {
      const result = await this.dlqService.reprocessAll();

      if (result.failed > result.processed) {
        throw new InternalServerErrorException(
          `More messages failed than processed`
        );
      }
      return {
        success: true,
        failed: result.failed,
        processed: result.processed,
      };
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to reprocess all messages: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        `Failed to reprocess all messages`
      );
    }
  }

  @Delete('/message/:orderId')
  public async discardMessage(
    @Param('orderId') orderId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const messageFounded = await this.dlqService.discardMessage(orderId);

      if (!messageFounded) {
        this.logger.error(`Message with ${orderId} not found in DLQ`);

        throw new NotFoundException(`Message with ${orderId} not found in DLQ`);
      }

      return {
        success: messageFounded,
        message: `Message with ${orderId} was successfully discard from DLQ`,
      };
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to discard message: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        `Failed to discard message`
      );
    }
  }

  @Delete('/purge')
  public async purge(): Promise<{ success: boolean; purgedCount: number }> {
    try {
      const count = await this.dlqService.purgeAll();

      return {
        success: true,
        purgedCount: count,
      };
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to purge DLQ: ${errorDetails.message}`,
        errorDetails.stack
      );

      throw new InternalServerErrorException(
        errorDetails,
        `Failed to purge DLQ`
      );
    }
  }
}
