import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * A guarda de entrada — e SÓ isso.
 *
 * O QUE ELA FAZ: olha se existe o cookie de renovação e, a partir daí,
 * empurra a pessoa para a tela certa. Um não autenticado não entra em
 * `/painel`; um autenticado não fica parado em `/login`.
 *
 * O QUE ELA NÃO FAZ, E É IMPORTANTE SABER: ela não autoriza nada de verdade.
 *
 * A checagem aqui é OTIMISTA. Ela só vê se o cookie está presente, não se ele
 * é válido — validar exigiria consultar a API a cada navegação, e essa espera
 * apareceria para o usuário em toda troca de tela. Por isso esta guarda serve
 * para dar a sensação certa ("você não está logado"), não para proteger dado.
 *
 * A proteção de verdade mora onde o dado mora: cada rota da API confere a
 * sessão por conta própria. Ou seja, mesmo que alguém forje um cookie com o
 * nome certo e passe por aqui, não vai ver nada — a API recusa a requisição.
 * Esconder uma tela nunca substituiu proteger a porta dos fundos.
 */

/**
 * O cookie que diz que existe uma sessão.
 *
 * É o de RENOVAÇÃO, e não o de acesso, de propósito: o de acesso vive 15
 * minutos e o de renovação, 7 dias. Se esta guarda olhasse o de acesso, quem
 * estivesse com a tela aberta seria expulso no meio do trabalho.
 *
 * O nome precisa ser idêntico ao `REFRESH_TOKEN_COOKIE` do backend
 * (apps/backend/src/auth/auth.constants.ts).
 */
const REFRESH_TOKEN_COOKIE = "refresh_token";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(REFRESH_TOKEN_COOKIE);

  if (pathname.startsWith("/painel") && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && hasSession) {
    return NextResponse.redirect(new URL("/painel", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Sem `matcher`, esta função rodaria em TODA requisição — inclusive nos
  // arquivos estáticos do Next, o que é trabalho jogado fora. Ela só interessa
  // nas duas rotas que dependem de saber se há sessão.
  matcher: ["/painel/:path*", "/login"],
};
