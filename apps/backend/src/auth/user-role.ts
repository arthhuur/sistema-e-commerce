/**
 * Os perfis de acesso do sistema.
 *
 * Cada perfil decide O QUE a pessoa pode fazer. Nomeamos em português porque
 * é assim que aparece na tela e no dia a dia da operação — o código inteiro
 * do projeto já segue essa convenção.
 *
 * A ordem importa para a leitura: do mais poderoso para o mais restrito.
 */
export const USER_ROLES = ['gerente', 'financeiro', 'vendedor', 'estoque'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Verifica em tempo de execução se um texto é um perfil válido.
 *
 * Isso é necessário porque o perfil vem de fora (do banco, ou de um token
 * antigo cujo formato mudou). O TypeScript confia no tipo; em execução,
 * alguém precisa desconfiar.
 */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
