import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../authenticated-user.js';

/**
 * Entrega o usuário logado direto no parâmetro do handler.
 *
 *   findAll(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * O guard já colocou esse objeto na requisição. Isto só evita repetir
 * `@Req() req` e acessar `req.user` na mão em cada rota.
 *
 * Serve também para um campo só:
 *
 *   @CurrentUser('role') role: UserRole
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    return field ? user?.[field] : user;
  },
);
