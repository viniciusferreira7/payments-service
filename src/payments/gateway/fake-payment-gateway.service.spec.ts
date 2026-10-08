import { Logger } from '@nestjs/common';
import { metrics } from '@/observability/metrics';
import {
  FakePaymentGatewayService,
  REJECTION_REASONS,
  randomLatency,
} from './fake-payment-gateway.service';

const ORDER_ID = '0b8f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const noDelay = () => Promise.resolve();

describe('FakePaymentGatewayService', () => {
  let gateway: FakePaymentGatewayService;
  const requests = { add: vi.fn() };
  const duration = { record: vi.fn() };
  const original = {
    requests: metrics.payment_gateway_requests,
    duration: metrics.payment_gateway_request_duration,
  };

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    Object.assign(metrics, {
      payment_gateway_requests: requests,
      payment_gateway_request_duration: duration,
    });
    gateway = new FakePaymentGatewayService(noDelay);
  });

  afterEach(() => {
    Object.assign(metrics, {
      payment_gateway_requests: original.requests,
      payment_gateway_request_duration: original.duration,
    });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([50, 0.01, 10000, 9999.98, 300])('approves %s', async (amount) => {
    const result = await gateway.charge({ orderId: ORDER_ID, amount });

    expect(result).toEqual({
      approved: true,
      transactionId: expect.stringMatching(
        /^fake_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    });
    expect(requests.add).toHaveBeenCalledWith(1, {
      operation: 'charge',
      outcome: 'approved',
    });
  });

  it.each([10000.01, 10000.99, 25000])(
    'rejects %s for exceeding the limit',
    async (amount) => {
      const result = await gateway.charge({ orderId: ORDER_ID, amount });

      expect(result).toEqual({
        approved: false,
        transactionId: expect.stringMatching(/^fake_/),
        rejectionReason: REJECTION_REASONS.LIMIT_EXCEEDED,
      });
    }
  );

  it.each([0.99, 49.99, 9999.99])(
    'rejects %s as declined by the issuer',
    async (amount) => {
      const result = await gateway.charge({ orderId: ORDER_ID, amount });

      expect(result.approved).toBe(false);
      expect(result.rejectionReason).toBe(REJECTION_REASONS.CARD_DECLINED);
      expect(requests.add).toHaveBeenCalledWith(1, {
        operation: 'charge',
        outcome: 'rejected',
      });
    }
  );

  it('uses the exact rejection texts', () => {
    expect(REJECTION_REASONS).toEqual({
      LIMIT_EXCEEDED: 'Limite excedido',
      CARD_DECLINED: 'Cartão recusado pela operadora',
    });
  });

  it('gives each charge its own transaction id', async () => {
    const a = await gateway.charge({ orderId: ORDER_ID, amount: 50 });
    const b = await gateway.charge({ orderId: ORDER_ID, amount: 50 });

    expect(a.transactionId).not.toBe(b.transactionId);
  });

  it('records the call duration', async () => {
    await gateway.charge({ orderId: ORDER_ID, amount: 50 });

    expect(duration.record).toHaveBeenCalledWith(expect.any(Number), {
      operation: 'charge',
    });
  });

  it('counts a failed call and rethrows it', async () => {
    const failure = new Error('gateway down');
    gateway = new FakePaymentGatewayService(() => Promise.reject(failure));

    await expect(
      gateway.charge({ orderId: ORDER_ID, amount: 50 })
    ).rejects.toThrow(failure);
    expect(requests.add).toHaveBeenCalledWith(1, {
      operation: 'charge',
      outcome: 'failed',
    });
  });

  describe('randomLatency', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      [0, 500],
      [0.9999, 2000],
    ])(
      'waits within [500, 2000] ms (random %s → %s ms)',
      async (random, ms) => {
        vi.spyOn(Math, 'random').mockReturnValue(random);
        let settled = false;

        const wait = randomLatency().then(() => {
          settled = true;
        });

        await vi.advanceTimersByTimeAsync(ms - 1);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await wait;
        expect(settled).toBe(true);
      }
    );
  });
});
