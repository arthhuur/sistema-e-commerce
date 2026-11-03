import type { AuthenticatedUser } from '../auth/authenticated-user.js';

/**
 * Ensina ao TypeScript que TODA requisição Express pode carregar o usuário
 * logado em `request.user`.
 *
 * POR QUE ISSO PRECISOU EXISTIR.
 *
 * O `JwtAuthGuard` grava o usuário em `request.user` para que o resto do
 * sistema (o `RolesGuard`, o decorator `@CurrentUser()`) o encontre. O
 * Express, porém, não conhece esse campo: sem esta declaração, cada linha que
 * escreve ou lê `request.user` seria um erro de compilação.
 *
 * A alternativa seria um `(request as any).user` espalhado pelos arquivos.
 * Funcionaria, e é pior: trocaria um erro de tipo por um campo sem nome nem
 * forma — e renomear `AuthenticatedUser` deixaria de quebrar a compilação,
 * que é justamente o aviso que queremos receber.
 *
 * O `user` é OPCIONAL de propósito: em rota `@Public()` ninguém passou pelo
 * guard e o campo realmente não existe. Quem lê, trata a ausência.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
