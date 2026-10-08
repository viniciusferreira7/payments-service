import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { makeModuleRef, startApp } from 'test/factories/make-module-ref';
import {
  signTestToken,
  tamperPayload,
  unsignedToken,
} from 'test/factories/make-token';
import { TestRoutesModule } from 'test/factories/test-routes.module';

const UNAUTHORIZED = { message: 'Unauthorized', statusCode: 401 };
const OTHER_SECRET = 'another-secret-that-is-at-least-32-chars';

describe('Global JWT guard (E2E)', () => {
  let app: INestApplication;

  const user = {
    id: randomUUID(),
    email: 'ana@marketplace.dev',
    role: 'buyer',
  };
  const claims = () => ({ sub: user.id, email: user.email, role: user.role });
  const now = () => Math.floor(Date.now() / 1000);
  const validToken = () => signTestToken(claims(), { expiresIn: '24h' });

  const whoAmI = (authorization?: string) => {
    const call = request(app.getHttpServer()).get('/test/protected');

    return authorization ? call.set('Authorization', authorization) : call;
  };

  beforeAll(async () => {
    const moduleRef = await makeModuleRef(
      (builder) => builder,
      [TestRoutesModule]
    );

    app = await startApp(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a protected route to a valid token, with exactly { id, email, role } as req.user', async () => {
    const response = await whoAmI(`Bearer ${validToken()}`).expect(200);

    expect(response.body).toEqual(user);
  });

  it.each<[string, () => string | undefined]>([
    ['no Authorization header', () => undefined],
    [
      'a token signed with another secret',
      () => `Bearer ${signTestToken(claims(), { secret: OTHER_SECRET })}`,
    ],
    [
      'a tampered payload',
      () => `Bearer ${tamperPayload(validToken(), { role: 'seller' })}`,
    ],
    [
      'an expired token',
      () =>
        `Bearer ${signTestToken({ ...claims(), iat: now() - 7200, exp: now() - 60 })}`,
    ],
    ['an alg none token', () => `Bearer ${unsignedToken(claims())}`],
    [
      'an HS512 token with the right secret',
      () => `Bearer ${signTestToken(claims(), { algorithm: 'HS512' })}`,
    ],
    [
      'a role outside seller and buyer',
      () => `Bearer ${signTestToken({ ...claims(), role: 'admin' })}`,
    ],
    [
      'a sub that is not a uuid',
      () => `Bearer ${signTestToken({ ...claims(), sub: 'user-1' })}`,
    ],
  ])('answers the same 401 to %s', async (_case, authorization) => {
    const response = await whoAmI(authorization()).expect(401);

    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it('keeps the public routes open', async () => {
    await request(app.getHttpServer()).get('/test/public').expect(200);
    await request(app.getHttpServer()).get('/').expect(200);
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('closes the dead letter queue to anonymous callers', async () => {
    await request(app.getHttpServer()).get('/dlq/stats').expect(401);
    await request(app.getHttpServer()).delete('/dlq/purge').expect(401);
  });
});
