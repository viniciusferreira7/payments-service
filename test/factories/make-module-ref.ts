import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder,
} from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { EnvModule } from '@/env/env.module';
import { EventsModule } from '@/events/events.module';
import { RabbitmqService } from '@/events/rabbitmq/rabbitmq.service';
import { FakeRabbitmqService } from '../events/fake-rabbitmq-service';

/**
 * Builds the application's DI container for the integration and e2e lanes.
 *
 * External infra that the suite does not own is replaced here — currently the
 * RabbitMQ connection. Postgres is *not* faked: these lanes run against a real
 * database, exactly as `vitest.config.int.ts` / `vitest.config.e2e.ts` expect.
 * Both lanes load `test/setup-env.ts`, which supplies the environment the Zod
 * schema in `src/env/env.ts` requires.
 *
 * Pass `configure` to layer per-spec overrides on top of the defaults:
 *
 * ```ts
 * const moduleRef = await makeModuleRef((builder) =>
 *   builder.overrideProvider(AppService).useValue(stub)
 * );
 * ```
 */
export async function makeModuleRef(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder
): Promise<TestingModule> {
  let builder = Test.createTestingModule({
    imports: [AppModule, EnvModule, EventsModule],
    providers: [],
  })
    .overrideProvider(RabbitmqService)
    .useClass(FakeRabbitmqService);

  if (configure) {
    builder = configure(builder);
  }

  return builder.compile();
}

/**
 * Boots the compiled module as an HTTP application, mirroring `src/main.ts`
 * so specs exercise the same CORS and validation behaviour as production.
 */
export async function startApp(
  moduleRef: TestingModule,
  options?: {
    beforeInit?: (app: NestExpressApplication) => Promise<void>;
  }
): Promise<INestApplication> {
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    })
  );

  if (options?.beforeInit) {
    await options.beforeInit(app);
  }

  await app.init();

  return app;
}
