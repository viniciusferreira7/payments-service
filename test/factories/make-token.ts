import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

const encode = (part: object) =>
  Buffer.from(JSON.stringify(part)).toString('base64url');

/** Signs with the test JWT_SECRET (HS256) unless `options` says otherwise. */
export function signTestToken(
  payload: object,
  options: JwtSignOptions = {}
): string {
  return new JwtService({ secret: process.env.JWT_SECRET }).sign(payload, {
    algorithm: 'HS256',
    ...options,
  });
}

/** An `alg: none` token: no signature at all. */
export function unsignedToken(payload: object): string {
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

/** Rewrites the payload of a signed token without re-signing it. */
export function tamperPayload(token: string, changes: object): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

  return [header, encode({ ...claims, ...changes }), signature].join('.');
}
