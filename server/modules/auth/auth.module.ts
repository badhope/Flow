import { randomBytes } from 'node:crypto';
import { Module, Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const DEVELOPMENT_ENVIRONMENTS = new Set(['development', 'test']);
const DEVELOPMENT_SECRET = randomBytes(32).toString('hex');

export function resolveJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET;
  const nodeEnv = process.env.NODE_ENV;
  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }
  if (!DEVELOPMENT_ENVIRONMENTS.has(nodeEnv ?? '')) {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required outside explicit development/test environments and must be at least 32 characters. Refusing to start.',
    );
  }

  const logger = new Logger('AuthModule');
  if (!envSecret) {
    logger.warn(
      'JWT_SECRET not set; using a process-local development secret.',
    );
  } else {
    logger.warn(
      'JWT_SECRET is too short (less than 32 chars); using a process-local development secret.',
    );
  }
  return DEVELOPMENT_SECRET;
}

@Module({
  imports: [
    // registerAsync：工厂在依赖注入阶段执行，确保 dotenv 先加载 .env 再读密钥
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: resolveJwtSecret(),
        signOptions: { expiresIn: '2h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
