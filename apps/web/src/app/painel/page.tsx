"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { USER_ROLE_LABELS } from "@payment-router/shared";
import type { AuthenticatedUser } from "@payment-router/shared";
import { ApiError, apiFetch, apiFetchWithSession } from "@/lib/api";
import { LogoutButton } from "@/components/logout-button";

/**
 * A área autenticada — hoje só a moldura dela.
 *
 * POR QUE ESTA TELA É TODA DE CLIENTE.
 *
 * O painel precisa de dois dados que só o navegador tem: a sessão (que existe
 * apenas como cookie `httpOnly`) e o que a API responde. Fazer essa busca no
 * servidor do Next exigiria copiar o cookie para dentro da chamada, à mão, em
 * cada requisição — um trabalho que o navegador já faz de graça. Aqui,
 * `GET /auth/me` sai como qualquer outra chamada do site e o cookie viaja
 * sozinho.
 *
 * A GUARDA DO SERVIDOR (`src/proxy.ts`) já garantiu, antes de esta tela
 * montar, que existe um cookie de sessão. O que esta tela faz é descobrir
 * QUEM é a pessoa e, se a sessão tiver acabado nesse meio-tempo, tirá-la daqui.
 *
 * O QUE ENTRA AQUI DEPOIS.
 *
 * Os números da operação (vendas, ticket médio, líquido recebido e taxas) já
 * existem na API, em `GET /dashboard/summary`. Eles são o próximo incremento;
 * esta moldura nasceu primeiro para provar que a sessão funciona de ponta a
 * ponta.
 */
export default function PanelPage() {
  const router = useRouter();

  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Muda a cada "tentar de novo".
   *
   * Serve como gatilho do efeito abaixo. É um contador, e não um texto de
   * erro, porque a intenção é "buscar outra vez" — e duas tentativas
   * seguidas precisam ser duas buscas, não uma.
   */
  const [attempt, setAttempt] = useState(0);

  /**
   * Sai da conta quando a sessão acabou de verdade.
   *
   * O logout é chamado ANTES de navegar porque só a API consegue apagar os
   * cookies `httpOnly`. Sem isso, o cookie velho continuaria no navegador e a
   * guarda mandaria a pessoa de volta ao painel — um vaivém sem explicação.
   *
   * O erro do logout é ignorado de propósito: se nem isso responder, sair da
   * tela ainda é o melhor que dá para fazer.
   */
  const endSession = useCallback(async () => {
    await apiFetch<void>("/auth/logout", { method: "POST" }).catch(
      () => undefined,
    );

    router.replace("/login");
  }, [router]);

  useEffect(() => {
    // A atribuição de estado acontece DENTRO dos retornos da promessa, nunca
    // no corpo do efeito. Assim o React não é obrigado a renderizar de novo
    // antes de a resposta chegar — e a regra que proíbe `setState` síncrono
    // em efeito continua respeitada.
    apiFetchWithSession<AuthenticatedUser>("/auth/me").then(
      (who) => {
        setUser(who);
        setFailure(null);
      },
      (caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 401) {
          // 401 mesmo depois da renovação automática: a sessão acabou.
          void endSession();
          return;
        }

        // Falha que NÃO é de sessão (a API fora do ar, a rede caindo). Aqui
        // não se navega a lugar nenhum: sair seria mentir sobre o que houve.
        setFailure(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível carregar os seus dados.",
        );
      },
    );
  }, [attempt, endSession]);

  if (failure !== null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="text-sm text-slate-600">
          {failure}
        </p>
        <button
          type="button"
          onClick={() => {
            setFailure(null);
            setAttempt((current) => current + 1);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Tentar de novo
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Payment Router
          </h1>
          <p className="text-sm text-slate-500">
            {user === null
              ? "Carregando…"
              : `${user.email} · ${USER_ROLE_LABELS[user.role]}`}
          </p>
        </div>

        {/* O botão só aparece quando já se sabe quem está logado: enquanto a
            resposta não chega, não há sessão confirmada para encerrar. */}
        {user !== null && <LogoutButton />}
      </header>

      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8">
        <h2 className="text-sm font-medium text-slate-700">Próximo passo</h2>
        <p className="mt-2 text-sm text-slate-600">
          A sessão está funcionando de ponta a ponta. O painel com os números
          da operação entra no incremento seguinte, a partir de{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            GET /dashboard/summary
          </code>
          .
        </p>
      </section>
    </main>
  );
}
