import { defineMetrics } from '@viniciusferreira7/signals';

export const metrics = defineMetrics(
  {
    payment_orders_consumed: {
      kind: 'counter',
      description:
        'Payment order messages taken off the queue, by how they settled',
    },
    payment_order_processing_duration: {
      kind: 'histogram',
      description: 'Time spent handling one payment order message',
      unit: 'ms',
    },
    payment_order_delivery_attempt: {
      kind: 'histogram',
      description: 'Delivery attempt on which a payment order settled',
      unit: '{attempt}',
    },
    payment_orders_in_flight: {
      kind: 'updowncounter',
      description: 'Payment order messages currently being processed',
    },
    payment_orders_rejected: {
      kind: 'counter',
      description: 'Payment orders the consumer refused, by validation reason',
    },
    payment_order_amount: {
      kind: 'histogram',
      description: 'Amount of each payment order accepted for processing',
      unit: '{amount}',
    },
    payment_gateway_requests: {
      kind: 'counter',
      description: 'Calls to the payment gateway, by operation and outcome',
    },
    payment_gateway_request_duration: {
      kind: 'histogram',
      description: 'Payment gateway call latency',
      unit: 'ms',
    },
    broker_connection_attempts: {
      kind: 'counter',
      description: 'RabbitMQ connection attempts, by outcome',
    },
    broker_publish_failures: {
      kind: 'counter',
      description: 'Messages this service failed to publish to the broker',
    },
    dlq_depth: {
      kind: 'gauge',
      description: 'Messages currently sitting in the dead letter queue',
    },
    dlq_operations: {
      kind: 'counter',
      description: 'Dead letter queue admin operations, by action and outcome',
    },
  },
  'payments-service'
);
