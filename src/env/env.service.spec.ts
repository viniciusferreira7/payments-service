import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvService } from './env.service';

describe('EnvService', () => {
  let service: EnvService;
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configService = { get: vi.fn().mockReturnValue('value') };
    service = new EnvService(configService as never);
  });

  it('delegates to the ConfigService with type inference', () => {
    const result = service.get('JWT_SECRET');

    expect(result).toBe('value');
    expect(configService.get).toHaveBeenCalledWith('JWT_SECRET', {
      infer: true,
    });
  });
});
