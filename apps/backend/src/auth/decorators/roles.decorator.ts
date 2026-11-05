import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../user-role.js';

export const ROLES_KEY = 'roles';

/**
 * Restringe a rota a determinados perfis.
 *
 *   @Roles('gerente', 'financeiro')
 *
 * Sem esta marcação, qualquer usuário logado passa — autenticação sem
 * autorização. É o erro mais comum em sistemas novos: "ele está logado,
 * então pode". Estar logado diz QUEM é; o perfil diz O QUE pode.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
