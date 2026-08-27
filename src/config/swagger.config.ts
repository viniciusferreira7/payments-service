import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { paymentsServiceDetails } from '@/utils/payments-service-details';

export const SWAGGER_PATH = 'api/docs';

/**
 * Describes this service for the OpenAPI document.
 *
 * The description is written flush left on purpose: Swagger UI renders it as
 * markdown, so indented lines would come out as a code block.
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Marketplace Payments Service')
    .setDescription(
      [
        'Payment processing for the Marketplace system.',
        '',
        'Responsibilities:',
        '- Consumes payment orders from the `payment.order` routing key',
        '- Validates the order amount against its items and discount',
        '- Routes messages it cannot process to the dead letter queue',
        '- Exposes the dead letter queue for inspection and reprocessing',
        '',
        'Authentication:',
        '- Use a JWT Bearer token for protected routes',
      ].join('\n')
    )
    .setVersion(paymentsServiceDetails.version)
    .setContact(
      'Marketplace Team',
      'https://marketplace.com',
      'dev@marketplace.com'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth'
    )
    .addTag('Payments', 'Payment processing endpoints')
    .addTag('Dead Letter Queue', 'Failed payment inspection and reprocessing')
    .addTag('Health', 'Health monitoring endpoints')
    .build();
}

/** Mounts Swagger UI at {@link SWAGGER_PATH}. */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Marketplace Payments Service Documentation',
    customfavIcon: './favicon',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #3b82f6 }
    `,
  });
}
