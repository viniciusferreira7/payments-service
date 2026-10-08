import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { z } from 'zod';
import { EnvService } from '../../env/env.service';
import type { AuthenticatedUser } from '../authenticated-user';
import { UserRole } from '../enums/user-role.enum';

/** The claims users-service `POST /auth/login` signs; anything else is refused. */
const tokenPayloadSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  role: z.enum(UserRole),
});

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(env: EnvService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.get('JWT_SECRET'),
      // Same algorithm users-service signs with; rejects `none` and swaps.
      algorithms: ['HS256'],
    });
  }

  validate(payload: unknown): AuthenticatedUser {
    const parsed = tokenPayloadSchema.safeParse(payload);

    if (!parsed.success) {
      throw new UnauthorizedException();
    }

    const { sub, email, role } = parsed.data;

    return { id: sub, email, role };
  }
}
