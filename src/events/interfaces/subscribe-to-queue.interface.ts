export interface SubscribeToQueue {
  queueName: string;
  exchange: string;
  routingKey: string;
  callback: (message: unknown) => Promise<void>;
}
