import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { TotpService } from './totp.service.js';
import { User } from './user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { RecoveryCode } from './recovery-code.entity.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { resolveJwtSecret } from './jwt-secret.js';

/**
 * O módulo de autenticação.
 *
 * Aqui estão DUAS decisões que valem para a aplicação inteira:
 *
 * 1. Os guards são registrados como `APP_GUARD`, ou seja, são GLOBAIS. Toda
 *    rota do sistema passa a exigir sessão, e abrir uma exceção exige marcar
 *    com `@Public()`. O padrão é fechado.
 *
 * 2. A ORDEM entre eles importa. O JwtAuthGuard roda primeiro e descobre
 *    QUEM é; o RolesGuard roda depois e decide O QUE pode. O Nest executa os
 *    guards globais na ordem em que são declarados, então inverter as duas
 *    linhas quebraria a autorização: o RolesGuard não teria usuário para
 *    consultar.
 *
 * O SEGREDO JWT VEM DE `jwt-secret.ts`, e não de uma constante local: a cifra
 * do segredo do TOTP deriva a chave dela a partir do mesmo lugar, e manter as
 * duas definições separadas seria pedir para elas divergirem.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, RecoveryCode]),
    JwtModule.register({
      // O segredo é resolvido na subida da aplicação, e não a cada
      // requisição: um erro de configuração deve impedir o boot, não aparecer
      // como falha de login em produção.
      secret: resolveJwtSecret(),
    }),
    // Proteção contra força bruta. O limite é apertado de propósito: ninguém
    // legítimo erra a senha 10 vezes por minuto. Vale só para o
    // AuthController, que é onde a tentativa de adivinhação acontece.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TotpService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // Exportados para que outras features possam usar `@Roles(...)` com os
  // mesmos tipos e, adiante, criar usuários (seed, gestão de acessos).
  exports: [AuthService, TokenService, TotpService],
})
export class AuthModule {}
