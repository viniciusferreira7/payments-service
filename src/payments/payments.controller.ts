import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@/auth/authenticated-user';
import { PaymentResponseDto } from './dtos/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':orderId')
  @ApiOperation({
    summary: "Get the payment of one of the user's orders",
    description:
      'Answers 404 until the payment order is consumed, then `pending` while it is charged, then `approved` or `rejected`.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: 'The order id is not a UUID' })
  @ApiNotFoundResponse({
    description: "No payment of the user's has this order id",
  })
  async findByOrderId(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() request: { user: AuthenticatedUser }
  ): Promise<PaymentResponseDto> {
    const payment = await this.paymentsService.findByOrderId(
      orderId,
      request.user.id
    );

    return PaymentResponseDto.from(payment);
  }
}
