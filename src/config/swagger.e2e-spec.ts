import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import {
  componentSchema,
  type HttpMethod,
  operationsUnder,
  readOpenApiDocument,
  responseSchema,
  responseStatuses,
} from 'test/config/openapi';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { SWAGGER_PATH, setupSwagger } from './swagger.config';

describe('Swagger (e2e)', () => {
  let app: INestApplication;

  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await makeModuleRef();

    app = await startApp(moduleRef, {
      beforeInit: async (nestApp) => {
        setupSwagger(nestApp);
      },
    });

    document = await readOpenApiDocument(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}`)
      .expect(200);

    expect(response.text).toContain('swagger-ui');
  });

  it('describes the service', () => {
    expect(document.info.title).toBe('Marketplace Payments Service');
    expect(document.info.description).toContain('Payment processing');
    expect(document.components?.securitySchemes?.['JWT-auth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents every route the application exposes', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      '/',
      '/dlq/message/{orderId}',
      '/dlq/messages',
      '/dlq/purge',
      '/dlq/reprocess-all',
      '/dlq/reprocess/{orderId}',
      '/dlq/stats',
    ]);
  });

  it('tags the routes so they group under the right heading', () => {
    const dlqOperations = operationsUnder(document, '/dlq');

    expect(dlqOperations).toHaveLength(6);

    for (const operation of dlqOperations) {
      expect(operation.tags).toEqual(['Dead Letter Queue']);
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toBeTruthy();
    }

    expect(document.paths['/'].get?.tags).toEqual(['Health']);
  });

  it('documents the stats response shape', () => {
    expect(responseSchema(document, '/dlq/stats', 'get', '200').$ref).toBe(
      '#/components/schemas/DlqStatsResponseDto'
    );

    expect(
      Object.keys(
        componentSchema(document, 'DlqStatsResponseDto').properties ?? {}
      )
    ).toEqual(['queueName', 'messageCount', 'consumerCount']);
  });

  it('documents the messages response shape', () => {
    expect(responseSchema(document, '/dlq/messages', 'get', '200').$ref).toBe(
      '#/components/schemas/DlqMessagesResponseDto'
    );

    expect(
      componentSchema(document, 'DlqMessagesResponseDto').properties?.messages
    ).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/DlqMessageDto' },
    });

    const message = componentSchema(document, 'DlqMessageDto');

    expect(message.properties?.content.$ref).toBe(
      '#/components/schemas/PaymentOrderMessageDto'
    );
    expect(message.required).not.toContain('deathInfo');

    expect(document.paths['/dlq/messages'].get?.parameters).toMatchObject([
      { name: 'limit', in: 'query', required: false },
    ]);
  });

  it('documents the order id path parameter', () => {
    const operations = [
      document.paths['/dlq/reprocess/{orderId}'].post,
      document.paths['/dlq/message/{orderId}'].delete,
    ];

    for (const operation of operations) {
      expect(operation?.parameters).toMatchObject([
        { name: 'orderId', in: 'path', required: true },
      ]);
    }
  });

  it('documents the status codes each route answers with', () => {
    const statusesFor = (path: string, method: HttpMethod) =>
      responseStatuses(document, path, method);

    expect(statusesFor('/dlq/stats', 'get')).toEqual(['200', '500']);
    expect(statusesFor('/dlq/messages', 'get')).toEqual(['200', '500']);
    expect(statusesFor('/dlq/reprocess/{orderId}', 'post')).toEqual([
      '201',
      '404',
      '500',
    ]);
    expect(statusesFor('/dlq/reprocess-all', 'post')).toEqual(['201', '500']);
    expect(statusesFor('/dlq/message/{orderId}', 'delete')).toEqual([
      '200',
      '404',
      '500',
    ]);
    expect(statusesFor('/dlq/purge', 'delete')).toEqual(['200', '500']);
  });
});
