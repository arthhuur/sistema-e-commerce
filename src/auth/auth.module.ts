import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';
import { User } from './user.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

/**
 * Ambientes em que é aceitável usar o segredo de desenvolvimento.
 *
 * A lista é de PERMISSÃO, não de proibição, e isso é o ponto: qualquer
 * ambiente que não esteja explicitamente aqui precisa de um segredo real.
 * Escrito ao contrário ("libero tudo menos produção"), um servidor com a
 * variável `NODE_ENV` esquecida cairia no caso permissivo e assinaria tokens
 * com um segredo público — que está neste arquivo, à vista de todos no
 * GitHub. Com a lista de permissão, o esquecimento produz o erro seguro.
 */
const ENVIRONMENTS_ALLOWING_DEV_SECRET = ['development', 'test'];

/** Longo o bastante para não ser adivinhável. Só vale fora de produção. */
const DEV_SECRET = 'apenas-para-desenvolvimento-nao-use-em-producao-1234567890';

const MINIMUM_SECRET_LENGTH = 32;

/**
 * Decide com qual segredo os tokens serão assinados.
 *
 * O SEGREDO JWT É A CHAVE DO REINO. Quem o conhece consegue assinar um token
 * dizendo "sou o gerente" — sem senha, sem nada — e a API acredita, porque a
 * assinatura confere. Não existe defesa depois disso.
 *
 * Por isso a ausência dele é um erro FATAL em ambiente que não seja
 * desenvolvimento: é melhor a aplicação não subir do que subir insegura.
 * Uma API fora do ar aparece no primeiro minuto; uma API com segredo público
 * pode passar meses sem ninguém notar.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret) {
    if (secret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET precisa ter ao menos ${MINIMUM_SECRET_LENGTH} caracteres. ` +
          'Gere um novo com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      );
    }
    return secret;
  }

  const environment = process.env.NODE_ENV ?? '';

  if (ENVIRONMENTS_ALLOWING_DEV_SECRET.includes(environment)) {
    return DEV_SECRET;
  }

  throw new Error(
    'JWT_SECRET não está definido. A aplicação não vai subir sem ele fora do ambiente de desenvolvimento. ' +
      'Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
  );
}

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
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // Exportados para que outras features possam usar `@Roles(...)` com os
  // mesmos tipos e, adiante, criar usuários (seed, gestão de acessos).
  exports: [AuthService, TokenService],
})
export class AuthModule {}
