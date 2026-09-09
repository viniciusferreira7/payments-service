import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@viniciusferreira7/signals/nest';
import { AppModule } from './app.module';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';
import { EnvService } from './env/env.service';
import { createShutdownHandler } from './health/graceful-shutdown';
import { ShutdownService } from './health/shutdown.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const envService = app.get(EnvService);
  const port = envService.get('PORT');

  app.useLogger(app.get(PinoLoggerService));

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  setupSwagger(app);

  registerGracefulShutdown(app, envService, new Logger('Shutdown'));

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀  Payments service running on port ${port}`);
  logger.log(
    `📚  Swagger documentation: http://localhost:${port}/${SWAGGER_PATH}`
  );
}

function registerGracefulShutdown(
  app: INestApplication,
  envService: EnvService,
  logger: Logger
) {
  const handleShutdown = createShutdownHandler({
    shutdownService: app.get(ShutdownService),
    drainDelayMs: envService.get('SHUTDOWN_DRAIN_DELAY_MS'),
    close: async () => {
      await app.close();
      // Best-effort: an unreachable OTLP collector must not fail the shutdown.
    },
    logger,
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      handleShutdown(signal).catch((err) =>
        logger.error(err, '[Shutdown] failed to shut down gracefully')
      );
    });
  }
}

bootstrap();
