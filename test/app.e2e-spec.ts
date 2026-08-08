import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from './factories/make-module-ref';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await makeModuleRef();
    app = await startApp(moduleRef);
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
