import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { SWAGGER_PATH, setupSwagger } from './swagger.config';

/**
 * The slice of JSON Schema these assertions read. The typed OpenAPI interfaces
 * model every member as a union with `ReferenceObject`, which buys nothing
 * here: the document is data under test, so it is narrowed on the way in.
 */
interface JsonSchema {
  $ref?: string;
  type?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

describe('Swagger (e2e)', () => {
  let app: INestApplication;

  /** The document as a client reading `/api/docs-json` receives it. */
  let document: OpenAPIObject;

  /** The schema a route answers `status` with, as JSON. */
  function responseSchema(
    path: string,
    method: 'get' | 'post' | 'delete',
    status: string
  ): JsonSchema {
    const response = document.paths[path][method]?.responses[status] as {
      content?: Record<string, { schema?: JsonSchema }>;
    };

    return response?.content?.['application/json']?.schema ?? {};
  }

  /** A named schema from `components.schemas`, as JSON. */
  function componentSchema(name: string): JsonSchema {
    return (document.components?.schemas?.[name] ?? {}) as JsonSchema;
  }

  beforeAll(async () => {
    const moduleRef = await makeModuleRef();

    app = await startApp(moduleRef, {
      beforeInit: async (nestApp) => {
        setupSwagger(nestApp);
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}-json`)
      .expect(200);

    document = response.body;
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
    const dlqOperations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/dlq'))
      .flatMap(([, item]) => [item.get, item.post, item.delete])
      .filter((operation) => operation !== undefined);

    expect(dlqOperations).toHaveLength(6);

    for (const operation of dlqOperations) {
      expect(operation.tags).toEqual(['Dead Letter Queue']);
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toBeTruthy();
    }

    expect(document.paths['/'].get?.tags).toEqual(['Health']);
  });

  it('documents the stats response shape', () => {
    expect(responseSchema('/dlq/stats', 'get', '200').$ref).toBe(
      '#/components/schemas/DlqStatsResponseDto'
    );

    expect(
      Object.keys(componentSchema('DlqStatsResponseDto').properties ?? {})
    ).toEqual(['queueName', 'messageCount', 'consumerCount']);
  });

  it('documents the messages response shape', () => {
    expect(responseSchema('/dlq/messages', 'get', '200').$ref).toBe(
      '#/components/schemas/DlqMessagesResponseDto'
    );

    expect(
      componentSchema('DlqMessagesResponseDto').properties?.messages
    ).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/DlqMessageDto' },
    });

    const message = componentSchema('DlqMessageDto');

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
    const statusesFor = (path: string, method: 'get' | 'post' | 'delete') =>
      Object.keys(document.paths[path][method]?.responses ?? {}).sort();

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
