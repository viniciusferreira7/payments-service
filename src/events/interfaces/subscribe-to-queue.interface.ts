export interface SubscribeToQueueRetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface SubscribeToQueue {
  queueName: string;
  exchange: string;
  routingKey: string;
  callback: (message: unknown) => Promise<void>;
  options?: SubscribeToQueueRetryOptions;
}
