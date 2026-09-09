import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import { DataSource } from 'typeorm';
import { ShutdownService } from './shutdown.service';

describe('Health probes (E2E)', () => {
  describe('with a reachable database', () => {
    let app: INestApplication;
    let shutdownService: ShutdownService;

    beforeAll(async () => {
      const moduleRef = await makeModuleRef();

      app = await startApp(moduleRef);
      shutdownService = moduleRef.get(ShutdownService);
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers the liveness probe without authentication', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
      });
    });

    it('answers the readiness probe with the database up', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
        checks: {
          database: {
            status: 'up',
            responseTime: expect.any(Number),
          },
        },
      });
    });

    it('answers the startup probe with the database up', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/startup')
        .expect(200);

      expect(response.body.checks.database.status).toBe('up');
    });

    it('fails the readiness probe once the process starts shutting down', async () => {
      shutdownService.markShuttingDown();

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.statusCode).toBe(503);
      expect(response.body.status).toBe('shutting_down');
    });

    it('keeps the liveness probe passing while shutting down', async () => {
      shutdownService.markShuttingDown();

      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('with an unreachable database', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await makeModuleRef((builder) =>
        builder.overrideProvider(DataSource).useFactory({
          factory() {
            return {
              query() {
                return Promise.reject(new Error('connection refused'));
              },

              isInitialized: false,

              async destroy() {
                // no connection to close: this double is never connected
              },
            };
          },
        })
      );

      app = await startApp(moduleRef);
    });

    afterAll(async () => {
      await app.close();
    });

    it('fails the readiness probe', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.statusCode).toBe(503);
      expect(response.body).toEqual({
        status: 'error',
        uptime: expect.any(Number),
        checks: {
          database: {
            status: 'down',
            responseTime: expect.any(Number),
          },
        },
      });
    });

    it('keeps the liveness probe passing', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });
});
