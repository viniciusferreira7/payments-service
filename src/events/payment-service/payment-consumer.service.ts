import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { getErrorDetails } from '@/utils/error.util';
import type { PaymentOrderMessage } from '../interfaces/payments-queue.interface';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';

@Injectable()
export class PaymentConsumerService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConsumerService.name);

  constructor(private readonly paymentQueueService: PaymentQueueService) {}

  async onModuleInit() {
    this.logger.log('Starting Payment Consumer Service');
    await this.startConsuming();
  }

  private async startConsuming() {
    this.logger.log('Starting to consume payment orders from queue');
    try {
      await this.paymentQueueService.consumePaymentOrders(
        this.processPaymentOrder.bind(this)
      );

      this.logger.log('Payment Consumer Service started successfully');
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to start consuming payment orders: ${errorDetails.message}`,
        errorDetails.stack
      );
    }
  }

  private async processPaymentOrder(
    message: PaymentOrderMessage
  ): Promise<void> {
    try {
      this.logger.debug(
        `Processing payment order: orderId=${message.orderId}, userId=${message.userId}, amount=${message.amount}`
      );

      const isValidMessage = this.validateMessage(message);

      if (!isValidMessage) {
        this.logger.error('Invalid payment message received');

        return;
      }

      //TODO: Implement payment service

      this.logger.log('Payment order received and validated');
    } catch (error) {
      const errorDetails = getErrorDetails(error);

      this.logger.error(
        `Failed to process payment for order: ${message.orderId}, error message:${errorDetails.message}`,
        errorDetails.stack
      );

      throw error;
    }
  }

  private validateMessage(message: PaymentOrderMessage): boolean {
    if (!message.orderId) {
      this.logger.error('Missing orderId in payment message');
      return false;
    }

    if (!message.userId) {
      this.logger.error('Missing userId in payment message');
      return false;
    }

    if (!message.amount || message.amount <= 0) {
      this.logger.error('Invalid amount in payment message');
      return false;
    }

    if (!message.paymentMethod) {
      this.logger.error('Missing paymentMethod in payment message');
      return false;
    }

    if (!message.items || message.items.length === 0) {
      this.logger.error('No items in payment message');
      return false;
    }

    return true;
  }
}
