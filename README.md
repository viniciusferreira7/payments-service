# payments-service

Payments microservice for the Marketplace microservices architecture. Consumes
the `payment.order` events published by the checkout service over RabbitMQ and
processes the resulting payments, backed by PostgreSQL via TypeORM.

## Where it sits

```
api-gateway (3333) ──▶ checkout-service (3334) ──[payments exchange]──▶ payments-service (3335)
                                                     routing key
                                                    payment.order
```

The checkout service is the producer; this service owns the `payment_queue`
bound to the `payments` topic exchange.

## Requirements

- Node 24+
- pnpm 11+
- Docker (PostgreSQL) and a reachable RabbitMQ broker

## Setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm start:dev
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm start:dev` | Watch mode with the observability preload |
| `pnpm build` | Compile to `dist/` |
| `pnpm check` / `pnpm check:fix` | Biome lint + format |
| `pnpm check:type` | `tsc --noEmit` |
| `pnpm test:unit` | Unit lane — `*.spec.ts`, no infra |
| `pnpm test:int` | Integration lane — `*.int-spec.ts`, real Postgres, faked broker |
| `pnpm test:e2e` | E2E lane — `*.e2e-spec.ts`, full HTTP boot against the shared broker |
| `pnpm test:cov` | Unit lane with coverage |

## Layout

```
src/
  app.module.ts            Root module: config + env + observability + TypeORM + events
  config/                  TypeORM options built from the validated env
  env/                     Zod schema, EnvModule and typed EnvService
  events/
    interfaces/            Message contracts shared with the producer
    rabbitmq/              Connection, channel, publish and subscribe primitives
    payment-queue/         Consumer for `payment.order`
  auth/  common/  health/  payments/  services/  utils/
test/
  setup-env.ts             Env defaults for the int/e2e lanes
  factories/               DI container and HTTP app builders
  events/                  FakeRabbitmqService
```

## Environment

Every variable is validated by `src/env/env.ts` at boot — an invalid or missing
value fails the process instead of surfacing later. See `.env.example` for the
full list.
