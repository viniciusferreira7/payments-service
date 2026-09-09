import { Module } from '@nestjs/common';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';
import { ShutdownService } from './shutdown.service';

@Module({
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, ShutdownService],
  exports: [ShutdownService],
})
export class HealthModule {}
