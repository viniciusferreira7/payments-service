import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PinoLoggerService } from '@viniciusferreira7/signals/nest';
import { AppModule } from './app.module';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';
import { EnvService } from './env/env.service';

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

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀  Payments service running on port ${port}`);
  logger.log(
    `📚  Swagger documentation: http://localhost:${port}/${SWAGGER_PATH}`
  );
}
bootstrap();
