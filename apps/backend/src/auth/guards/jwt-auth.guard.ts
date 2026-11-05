import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { isUserRole } from '../user-role.js';
import type { AccessTokenPayload } from '../authenticated-user.js';

/**
 * O porteiro de entrada: sem sessão válida, ninguém passa.
 *
 * Está registrado como guard GLOBAL no AuthModule, então vale para toda a
 * aplicação sem precisar repetir `@UseGuards` em cada controller. Rotas
 * públicas se identificam com `@Public()`.
 *
 * POR QUE NÃO USAMOS PASSPORT.
 *
 * O Passport é o caminho tradicional no Nest, mas aqui ele traria uma
 * biblioteca a mais e uma camada de indireção para fazer o que são ~20 linhas
 * explícitas: ler o cookie, verificar a assinatura, montar o usuário. Menos
 * peças móveis e um fluxo que se lê de cima a baixo.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // A marcação de rota pública é lida do handler E da classe, nessa ordem —
    // assim `@Public()` no controller inteiro também funciona.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      // A mensagem é a mesma para "não tem token", "token vencido" e "token
      // adulterado". Distinguir os casos daria informação de graça a quem
      // estivesse sondando o sistema, e não ajuda em nada quem é legítimo:
      // a ação é a mesma nos três casos — entrar de novo.
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    // O token foi assinado por nós, mas o conteúdo ainda é dado de entrada:
    // pode vir de um token emitido antes de uma mudança no formato. Validar
    // aqui evita que um perfil inventado chegue até o RolesGuard.
    if (!isUserRole(payload.role)) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    return true;
  }

  /**
   * O token vem do cookie `httpOnly`.
   *
   * Não aceitamos `Authorization: Bearer` aqui de propósito. Um mecanismo só
   * significa um só lugar para proteger e auditar; dois mecanismos costumam
   * significar que o mais fraco define a segurança do conjunto.
   */
  private extractToken(request: Request): string | undefined {
    return request.cookies?.[ACCESS_TOKEN_COOKIE];
  }
}
