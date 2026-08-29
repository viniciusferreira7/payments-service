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
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { getErrorDetails } from '@/utils/error.util';
import { DlqService } from './dlq.service';
import {
  DlqMessageActionResponseDto,
  DlqMessagesResponseDto,
  DlqPurgeResponseDto,
  DlqReprocessAllResponseDto,
  DlqStatsResponseDto,
} from './dto/dlq-response.dto';
import type { DLQMessage } from './interfaces/dlq-message.interface';
import type { DLQStats } from './interfaces/dlq-stats.interface';

@ApiTags('Dead Letter Queue')
@Controller('dlq')
export class DlqController {
  private readonly logger = new Logger(DlqController.name);

  constructor(private readonly dlqService: DlqService) {}

  @Get('/stats')
  @ApiOperation({
    summary: 'Get dead letter queue stats',
    description:
      'Returns how many payment messages are waiting in the dead letter queue and how many consumers are attached to it.',
  })
  @ApiOkResponse({
    description: 'Current dead letter queue stats',
    type: DlqStatsResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'The dead letter queue could not be inspected',
  })
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
  @ApiOperation({
    summary: 'Peek at dead letter messages',
    description:
      'Reads messages from the dead letter queue without consuming them, so they stay available for reprocessing.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'How many messages to read. Defaults to 10.',
    example: '10',
  })
  @ApiOkResponse({
    description: 'Messages currently held in the dead letter queue',
    type: DlqMessagesResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'The dead letter queue could not be read',
  })
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
  @ApiOperation({
    summary: 'Reprocess one dead letter message',
    description:
      'Republishes the dead letter message for the given order back to the main payment queue.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order carried by the dead letter message',
    example: 'b1d4f8a2-7c31-4c8e-9a2f-6d0b5e7c1a44',
  })
  @ApiResponse({
    status: 201,
    description: 'The message was sent back to the main queue',
    type: DlqMessageActionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No dead letter message matches the given order',
  })
  @ApiInternalServerErrorResponse({
    description: 'The message could not be republished',
  })
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
  @ApiOperation({
    summary: 'Reprocess every dead letter message',
    description:
      'Drains the dead letter queue, republishing each message to the main payment queue, and reports how many succeeded and failed.',
  })
  @ApiResponse({
    status: 201,
    description: 'The queue was drained back into the main queue',
    type: DlqReprocessAllResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description:
      'The queue could not be drained, or more messages failed than were republished',
  })
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
  @ApiOperation({
    summary: 'Discard one dead letter message',
    description:
      'Permanently drops the dead letter message for the given order. The message is not republished.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order carried by the dead letter message',
    example: 'b1d4f8a2-7c31-4c8e-9a2f-6d0b5e7c1a44',
  })
  @ApiOkResponse({
    description: 'The message was discarded',
    type: DlqMessageActionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No dead letter message matches the given order',
  })
  @ApiInternalServerErrorResponse({
    description: 'The message could not be discarded',
  })
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
  @ApiOperation({
    summary: 'Purge the dead letter queue',
    description:
      'Permanently drops every message in the dead letter queue and reports how many were removed.',
  })
  @ApiOkResponse({
    description: 'The dead letter queue was emptied',
    type: DlqPurgeResponseDto,
  })
  @ApiInternalServerErrorResponse({
    description: 'The dead letter queue could not be purged',
  })
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
