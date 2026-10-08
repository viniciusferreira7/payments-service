import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signTestToken } from '../factories/make-token';

/** Drives the DLQ routes as an authenticated user; they are not public. */
export function makeDlqClient(app: INestApplication) {
  const token = signTestToken(
    { sub: randomUUID(), email: 'ops@marketplace.dev', role: 'seller' },
    { expiresIn: '1h' }
  );
  const auth = `Bearer ${token}`;
  const http = () => request(app.getHttpServer());

  return {
    stats: () => http().get('/dlq/stats').set('Authorization', auth),
    messages: (limit?: string) =>
      limit
        ? http()
            .get('/dlq/messages')
            .query({ limit })
            .set('Authorization', auth)
        : http().get('/dlq/messages').set('Authorization', auth),
    reprocess: (orderId: string) =>
      http().post(`/dlq/reprocess/${orderId}`).set('Authorization', auth),
    reprocessAll: () =>
      http().post('/dlq/reprocess-all').set('Authorization', auth),
    discard: (orderId: string) =>
      http().delete(`/dlq/message/${orderId}`).set('Authorization', auth),
    purge: () => http().delete('/dlq/purge').set('Authorization', auth),
  };
}
