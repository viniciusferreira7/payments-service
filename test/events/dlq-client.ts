import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export function makeDlqClient(app: INestApplication) {
  const http = () => request(app.getHttpServer());

  return {
    stats: () => http().get('/dlq/stats'),
    messages: (limit?: string) =>
      limit
        ? http().get('/dlq/messages').query({ limit })
        : http().get('/dlq/messages'),
    reprocess: (orderId: string) => http().post(`/dlq/reprocess/${orderId}`),
    reprocessAll: () => http().post('/dlq/reprocess-all'),
    discard: (orderId: string) => http().delete(`/dlq/message/${orderId}`),
    purge: () => http().delete('/dlq/purge'),
  };
}
