/**
 * Normaliza o e-mail antes de gravar ou procurar.
 *
 * Arquivo próprio, e não uma função solta dentro do AuthService, porque três
 * lugares precisam desta MESMA regra: o login, a gestão de usuários e o
 * script de seed. Se cada um normalizasse do seu jeito, o dia em que a regra
 * mudasse um deles ficaria para trás — e o sintoma seria "a senha está certa,
 * mas não entra", que é dos bugs mais chatos de achar.
 *
 * `trim` porque espaço no fim de um campo copiado e colado é invisível para
 * quem digita. `toLowerCase` porque e-mail não diferencia maiúsculas na
 * prática, e o banco diferencia.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
