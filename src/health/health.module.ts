import { Module } from '@nestjs/common';
import { EventsModule } from '@/events/events.module';
import { DatabaseHealthIndicator } from './database-health.indicator';
import { HealthController } from './health.controller';
import { RabbitmqHealthIndicator } from './rabbitmq-health.indicator';
import { ShutdownService } from './shutdown.service';

@Module({
  imports: [EventsModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RabbitmqHealthIndicator,
    ShutdownService,
  ],
  exports: [ShutdownService],
})
export class HealthModule {}
