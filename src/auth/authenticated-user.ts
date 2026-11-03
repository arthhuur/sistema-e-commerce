import type { UserRole } from './user-role.js';

/**
 * Quem está do outro lado da requisição, depois que o guard validou o token.
 *
 * Note que isto é um recorte: só o que a aplicação precisa para decidir
 * permissão. O hash da senha não entra aqui — nada que não seja necessário
 * para autorizar deve circular pelo resto do sistema.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * O conteúdo assinado dentro do token de acesso.
 *
 * `sub` (subject) é o nome padrão do campo que identifica o dono do token.
 * Manter o padrão importa: se um dia trocarmos a biblioteca ou integrarmos
 * outro serviço, o formato continua sendo o esperado.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}
