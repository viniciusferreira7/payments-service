import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class Routes {
  @Public()
  open() {
    // route body is irrelevant here
  }

  closed() {
    // route body is irrelevant here
  }
}

@Public()
class OpenController {
  anyRoute() {
    // route body is irrelevant here
  }
}

function contextFor(
  controller: new () => object,
  handler: (...args: never[]) => unknown
) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

/** The Passport `AuthGuard('jwt')` mixin the guard extends. */
const passportGuard = Object.getPrototypeOf(JwtAuthGuard.prototype);

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(new Reflector());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a public route through without asking Passport', async () => {
    const passport = vi.spyOn(passportGuard, 'canActivate');

    await expect(
      guard.canActivate(contextFor(Routes, Routes.prototype.open))
    ).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });

  it('lets every route of a public controller through', async () => {
    const passport = vi.spyOn(passportGuard, 'canActivate');

    await expect(
      guard.canActivate(
        contextFor(OpenController, OpenController.prototype.anyRoute)
      )
    ).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });

  it('hands a protected route to Passport', async () => {
    const passport = vi
      .spyOn(passportGuard, 'canActivate')
      .mockResolvedValue(true);
    const context = contextFor(Routes, Routes.prototype.closed);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(passport).toHaveBeenCalledWith(context);
  });

  it('returns the authenticated user', () => {
    const user = { id: 'user-1', email: 'ana@marketplace.dev', role: 'seller' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('answers a generic 401 when there is no user', () => {
    expect(() => guard.handleRequest(null, false)).toThrow(
      new UnauthorizedException()
    );
  });

  it('answers a generic 401 whatever the underlying error', () => {
    expect(() => guard.handleRequest(new Error('jwt expired'), false)).toThrow(
      new UnauthorizedException()
    );
  });
});
