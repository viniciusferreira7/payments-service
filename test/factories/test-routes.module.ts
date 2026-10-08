import { Controller, Get, Module, Req } from '@nestjs/common';
import { Public } from '@/auth/decorators/public.decorator';

/** No `@Public()`: stands for any protected route the service will add. */
@Controller('test/protected')
class ProtectedTestController {
  @Get()
  whoAmI(@Req() request: { user: unknown }) {
    return request.user;
  }
}

@Public()
@Controller('test/public')
class PublicTestController {
  @Get()
  ping() {
    return { ok: true };
  }
}

/** Routes that exist only in the e2e lane, to exercise the global guard. */
@Module({ controllers: [ProtectedTestController, PublicTestController] })
export class TestRoutesModule {}
