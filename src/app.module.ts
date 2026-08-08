import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservabilityModule } from '@viniciusferreira7/signals/nest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseConfig } from './config/database.config';
import { envSchema } from './env/env';
import { EnvModule } from './env/env.module';
import { EnvService } from './env/env.service';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.test', '.env'],
      validate: (env) => {
        return envSchema.parse(env);
      },
    }),
    EnvModule,
    ObservabilityModule.forRoot({ serviceName: 'payments-service' }),
    TypeOrmModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: databaseConfig,
    }),
    EventsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
