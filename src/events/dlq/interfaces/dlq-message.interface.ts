import type { PaymentOrderMessage } from '@/events/interfaces/payments-queue.interface';

export interface DLQMessageDeathInfo {
  reason: string;
  queue: string;
  time: Date;
  count: number;
  exchange: string;
  routingKeys: Array<string>;
}

export interface DLQMessage {
  content: PaymentOrderMessage;
  properties: {
    messageId?: string;
    timestamp?: number;
    headers?: Record<string, unknown>;
  };
  deathInfo?: DLQMessageDeathInfo;
}
