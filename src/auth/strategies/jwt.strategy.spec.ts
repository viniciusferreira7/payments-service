import { UnauthorizedException } from '@nestjs/common';
import type { EnvService } from '../../env/env.service';
import { UserRole } from '../enums/user-role.enum';
import { JwtStrategy } from './jwt.strategy';

const env = {
  get: () => 'unit-test-jwt-secret-with-32-chars!',
} as unknown as EnvService;

const payload = {
  sub: '3f2a1c9e-8b7d-4e6f-9a5b-1c2d3e4f5a6b',
  email: 'ana@marketplace.dev',
  role: UserRole.SELLER,
  iat: 1_790_000_000,
  exp: 1_790_086_400,
};

describe('JwtStrategy.validate', () => {
  const strategy = new JwtStrategy(env);

  it('maps the payload to exactly { id, email, role }', () => {
    expect(strategy.validate(payload)).toEqual({
      id: payload.sub,
      email: 'ana@marketplace.dev',
      role: UserRole.SELLER,
    });
  });

  it.each([
    ['without sub', { ...payload, sub: undefined }],
    ['with a sub that is not a uuid', { ...payload, sub: 'user-1' }],
    ['without email', { ...payload, email: undefined }],
    ['with an invalid email', { ...payload, email: 'not-an-email' }],
    ['with a role outside seller and buyer', { ...payload, role: 'admin' }],
    ['that is not an object', 'a-string-payload'],
  ])('refuses a payload %s', (_case, invalid) => {
    expect(() => strategy.validate(invalid)).toThrow(UnauthorizedException);
  });
});
