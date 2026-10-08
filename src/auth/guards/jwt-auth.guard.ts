import {
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally: every route needs a valid Bearer token unless it, or
 * its controller, is marked `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }

  /**
   * One answer for every failure — missing, malformed, expired or forged
   * token — so the response never says which check failed.
   */
  handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
