import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../authenticated-user.js';
import type { UserRole } from '../user-role.js';

/**
 * O segundo porteiro: confere se o PERFIL pode entrar naquela porta.
 *
 * Roda depois do JwtAuthGuard, e a ordem é o que faz sentido: primeiro
 * descobrimos quem é, depois o que ele pode. Invertido, não haveria usuário
 * para consultar.
 *
 * SEM `@Roles(...)`, QUALQUER PESSOA LOGADA PASSA. Isso é intencional: a
 * maioria das rotas é de uso geral. As restritas é que declaram o perfil.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    // Sem usuário, a rota exigia perfil mas ninguém se identificou. Isso só
    // acontece se a rota for marcada como `@Public()` E com `@Roles()` ao
    // mesmo tempo — combinação contraditória. Recusar é a resposta segura.
    if (!user) {
      throw new ForbiddenException('Acesso não permitido.');
    }

    if (!requiredRoles.includes(user.role)) {
      // 403 e não 401: 401 é "você não se identificou"; 403 é "sei quem você
      // é, e você não pode". Trocar os dois confunde o front, que precisa
      // saber se deve mandar o usuário para o login ou mostrar "sem acesso".
      throw new ForbiddenException('Seu perfil não tem acesso a este recurso.');
    }

    return true;
  }
}
