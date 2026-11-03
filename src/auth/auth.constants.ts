/**
 * Os nomes e tempos dos cookies de sessão, num lugar só.
 *
 * Centralizar evita o bug clássico de escrever o cookie com um nome no login
 * e tentar lê-lo com outro na hora de sair — que falha em silêncio (o logout
 * "não faz nada") e é chato de descobrir.
 */

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** 15 minutos. Curto de propósito: se vazar, vale pouco. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** 7 dias. É o que mantém a pessoa logada sem digitar a senha todo dia. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * As opções dos cookies de sessão.
 *
 * CADA FLAG TEM UM MOTIVO:
 *
 * - `httpOnly`: o JavaScript da página NÃO consegue ler o cookie. É esta flag
 *   que impede que um XSS roube a sessão. Sem ela, todo o resto é teatro.
 * - `secure`: o navegador só envia por HTTPS. Em produção (Render) sempre
 *   ligado; em desenvolvimento fica desligado porque o local roda em HTTP.
 * - `sameSite`: a defesa contra CSRF. Pelo padrão, `lax` — o cookie não
 *   acompanha requisições vindas de outro site. Se o front e a API ficarem em
 *   domínios realmente diferentes, o navegador só envia com `none`; por isso
 *   o valor é configurável por `COOKIE_SAME_SITE`.
 *
 * SOBRE O `path`.
 *
 * Ambos usam `path: '/'`, e isso é uma decisão consciente. Seria mais
 * restrito mandar o refresh token apenas para `/auth/refresh`, mas isso
 * quebra o cenário mais provável de produção: se o front publicar a API sob
 * um prefixo (ex.: `/api/...`), o caminho deixa de casar e o navegador
 * simplesmente nunca envia o cookie — o login funcionaria e a renovação não,
 * um bug difícil de enxergar. O ganho de restringir o caminho não compensa
 * esse risco, já que o cookie é `httpOnly` de qualquer forma.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredSameSite = process.env.COOKIE_SAME_SITE;

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: (configuredSameSite ?? 'lax') as 'lax' | 'strict' | 'none',
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}
