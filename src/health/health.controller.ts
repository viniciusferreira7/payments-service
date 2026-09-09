import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { ShutdownService } from './shutdown.service';

/** Minimal surface of the underlying HTTP reply, so this file does not depend
 * on the adapter's typings. */
type HttpReply = { status: (code: number) => unknown };

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
    private readonly shutdownService: ShutdownService
  ) {}

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe: the process is up and the event loop responds',
  })
  @ApiOkResponse({ description: 'Process is alive' })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe: the instance can serve traffic',
  })
  @ApiOkResponse({ description: 'Instance is ready to serve traffic' })
  @ApiServiceUnavailableResponse({
    description: 'A dependency is down or the process is shutting down',
  })
  ready(@Res({ passthrough: true }) reply: HttpReply) {
    return this.readiness(reply);
  }

  @Get('startup')
  @ApiOperation({
    summary: 'Startup probe: the instance finished booting',
  })
  @ApiOkResponse({ description: 'Instance finished booting' })
  @ApiServiceUnavailableResponse({ description: 'Instance is still booting' })
  startup(@Res({ passthrough: true }) reply: HttpReply) {
    return this.readiness(reply);
  }

  private async readiness(reply: HttpReply) {
    const uptime = process.uptime();

    if (this.shutdownService.isShuttingDown) {
      reply.status(503);

      return { status: 'shutting_down', uptime };
    }

    const database = await this.databaseHealthIndicator.check();

    if (database.status === 'down') {
      reply.status(503);

      return { status: 'error', uptime, checks: { database } };
    }

    return { status: 'ok', uptime, checks: { database } };
  }
}
