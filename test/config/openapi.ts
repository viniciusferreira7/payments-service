import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { SWAGGER_PATH } from '@/config/swagger.config';

export interface JsonSchema {
  $ref?: string;
  type?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export type HttpMethod = 'get' | 'post' | 'delete';

export async function readOpenApiDocument(
  app: INestApplication
): Promise<OpenAPIObject> {
  const response = await request(app.getHttpServer())
    .get(`/${SWAGGER_PATH}-json`)
    .expect(200);

  return response.body;
}

export function responseSchema(
  document: OpenAPIObject,
  path: string,
  method: HttpMethod,
  status: string
): JsonSchema {
  const response = document.paths[path][method]?.responses[status] as {
    content?: Record<string, { schema?: JsonSchema }>;
  };

  return response?.content?.['application/json']?.schema ?? {};
}

export function componentSchema(
  document: OpenAPIObject,
  name: string
): JsonSchema {
  return (document.components?.schemas?.[name] ?? {}) as JsonSchema;
}

export function responseStatuses(
  document: OpenAPIObject,
  path: string,
  method: HttpMethod
): string[] {
  return Object.keys(document.paths[path][method]?.responses ?? {}).sort();
}

export function operationsUnder(
  document: OpenAPIObject,
  prefix: string
): Array<NonNullable<OpenAPIObject['paths'][string]['get']>> {
  return Object.entries(document.paths)
    .filter(([path]) => path.startsWith(prefix))
    .flatMap(([, item]) => [item.get, item.post, item.delete])
    .filter((operation) => operation !== undefined);
}
