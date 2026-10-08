import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/decorators/public.decorator';
import { AppService } from './app.service';

@Public()
@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Check that the service is up',
    description: 'Returns a static greeting, used as a liveness probe.',
  })
  @ApiOkResponse({
    description: 'The service is running',
    schema: { type: 'string', example: 'Hello World!' },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
