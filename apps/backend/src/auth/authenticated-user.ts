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

/**
 * O token CURTO que fica no meio do login em duas etapas.
 *
 * Quando a senha confere mas a conta tem 2FA, a sessão não é aberta ainda —
 * falta o segundo fator. Mas a segunda etapa precisa saber DE QUEM é a
 * confirmação, sem pedir a senha de novo. Este token é essa ponte: ele diz
 * "a senha desta pessoa já foi conferida, agora apresente o código".
 *
 * `scope` NÃO É DECORAÇÃO. É o que separa este token de um token de acesso.
 * Sem ele, um token de sessão valeria como token de MFA e vice-versa — e
 * como os dois são assinados com o mesmo segredo, a única coisa que os
 * distingue é este campo. O guard de sessão também recusa este token (ele não
 * tem `role`), então os dois sentidos estão fechados.
 */
export interface MfaTokenPayload {
  sub: string;
  scope: 'mfa';
}
