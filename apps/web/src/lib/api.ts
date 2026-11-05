/**
 * O único ponto do front que sabe falar com a API.
 *
 * POR QUE CENTRALIZAR ISSO.
 *
 * Toda chamada precisa das mesmas três coisas: o prefixo certo, os cookies e
 * o tratamento de erro. Espalhadas pelo código, uma delas sai diferente — e o
 * sintoma é sempre o mesmo: "o login funciona na tela A e não na B".
 * Passando por aqui, é impossível esquecer.
 */

import type { AuthenticatedUser } from "@payment-router/shared";

/**
 * O prefixo que o `next.config.ts` reescreve para a API.
 *
 * O navegador pede `/api/...` ao front, e o Next repassa para o backend
 * tirando o prefixo. Do lado de fora, parece que a API mora aqui.
 */
const API_PREFIX = "/api";

/**
 * Um erro que veio da API (ou do caminho até ela), já com a mensagem pronta
 * para a tela.
 *
 * Ele carrega o `status` porque a tela às vezes precisa reagir de forma
 * diferente: um 401 é "faça login de novo", um 429 é "espere um pouco".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * As chamadas deste front sempre mandam e recebem JSON, e nunca precisam de
 * cabeçalho próprio. Restringir o tipo a isso evita que alguém passe um
 * `Headers` cru e o `content-type` seja sobrescrito por engano.
 */
type ApiRequestInit = Omit<RequestInit, "headers" | "credentials" | "cache">;

export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: { "content-type": "application/json" },
    // Envia os cookies de sessão nesta chamada E aceita os que voltarem.
    // É isso que mantém a pessoa logada entre uma requisição e a próxima.
    credentials: "same-origin",
    // Nada de cache: o painel mostra o estado de agora, não o de ontem.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  // O logout responde 204 (sem corpo). Tentar ler JSON aqui estouraria.
  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Igual ao `apiFetch`, mas renova a sessão quando o token de acesso venceu.
 *
 * POR QUE ISSO NÃO É CAPRICHO.
 *
 * O token de acesso vive 15 minutos; o de renovação, 7 dias. Sem este passo,
 * qualquer tela que carregasse dado depois de um quarto de hora receberia um
 * 401 — e a pessoa seria expulsa no meio do trabalho, apesar de a sessão dela
 * estar viva. É o tipo de falha que aparece sempre "depois de um tempo" e
 * custa caro para diagnosticar.
 *
 * O CAMINHO É ESTE: ao receber 401, troca-se o cookie de renovação por um par
 * novo e a chamada original é repetida. No caso comum, quem está usando não
 * percebe nada.
 *
 * Só use esta versão em rotas que representam DADO (o painel, a lista de
 * pagamentos). Nas rotas de login ela seria prejudicial: lá o 401 significa
 * "senha errada" ou "código errado", e renovar a sessão em cima disso seria
 * responder a uma pergunta que ninguém fez.
 */
export async function apiFetchWithSession<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }

    await apiFetch<AuthenticatedUser>("/auth/refresh", { method: "POST" });

    // Se a renovação também falhar, o erro sobe daqui — e aí sim a sessão
    // acabou de verdade, e quem chamou precisa tratar isso.
    return await apiFetch<T>(path, init);
  }
}

/**
 * Extrai a mensagem que a API mandou, em ordem de preferência.
 *
 * A API responde erro no formato do NestJS: `{ message, error, statusCode }`.
 * O campo `message` pode vir como texto ("E-mail ou senha incorretos.") ou
 * como LISTA, quando a falha é de validação e vários campos reclamam ao mesmo
 * tempo. Os dois casos são tratados.
 */
async function readErrorMessage(response: Response): Promise<string> {
  // O limite de tentativas do login é o único caso em que o texto que o Nest
  // manda não serve: sai algo técnico, do tipo "ThrottlerException: Too many
  // requests". Aqui ele é trocado por uma frase que faz sentido para quem está
  // apenas tentando entrar.
  if (response.status === 429) {
    return "Tentativas demais em pouco tempo. Espere um instante e tente de novo.";
  }

  try {
    const body = (await response.json()) as { message?: string | string[] };

    if (Array.isArray(body.message)) {
      return body.message.join(" ");
    }

    if (body.message) {
      return body.message;
    }
  } catch {
    // Corpo vazio ou que não é JSON — acontece quando quem respondeu foi um
    // proxy no meio do caminho (um 502, por exemplo), e não a API.
  }

  return "Não foi possível completar a solicitação. Tente de novo.";
}
