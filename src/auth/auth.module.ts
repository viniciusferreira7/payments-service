import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Verifies the tokens users-service signs. Nothing is signed here, so there is
 * no JwtModule and no auth controller: login and register live in
 * users-service.
 */
@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
})
export class AuthModule {}
