"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { USER_ROLE_LABELS } from "@payment-router/shared";
import type {
  AuthenticatedUser,
  DashboardSummary,
  Paginated,
  Payment,
} from "@payment-router/shared";
import { ApiError, apiFetch, apiFetchWithSession } from "@/lib/api";
import { LogoutButton } from "@/components/logout-button";
import { SummaryCards } from "@/components/summary-cards";
import { RecentPayments } from "@/components/recent-payments";

/**
 * O painel de operação — a primeira resposta que a tela dá.
 *
 * "Como está o movimento de hoje?", respondida com quatro números e uma lista
 * curta. Nada além disso: gráfico de doze meses e filtro de oito campos são o
 * próximo nível, e só entram depois que estes números provarem que a tela é
 * útil.
 *
 * POR QUE ESTA TELA É TODA DE CLIENTE.
 *
 * O painel precisa de dois dados que só o navegador tem: a sessão (que existe
 * apenas como cookie `httpOnly`) e o que a API responde. Fazer essa busca no
 * servidor do Next exigiria copiar o cookie para dentro da chamada, à mão, em
 * cada requisição — um trabalho que o navegador já faz de graça.
 *
 * A GUARDA DO SERVIDOR (`src/proxy.ts`) já garantiu, antes de esta tela
 * montar, que existe um cookie de sessão. O que esta tela faz é descobrir QUEM
 * é a pessoa, buscar os números, e — se a sessão tiver acabado nesse meio-tempo
 * — tirá-la daqui.
 */
export default function PanelPage() {
  const router = useRouter();

  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryDenied, setSummaryDenied] = useState(false);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Muda a cada "tentar de novo".
   *
   * Serve como gatilho do efeito abaixo. É um contador, e não um texto de erro,
   * porque a intenção é "buscar outra vez" — e duas tentativas seguidas
   * precisam ser duas buscas, não uma.
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
    // As três buscas saem EM PARALELO, e não em fila. Se uma esperasse a outra,
    // a tela ficaria mais lenta sem nenhum ganho — elas não dependem entre si.
    // `allSettled` (e não `all`) porque uma falha isolada não deve derrubar as
    // outras duas: se só o resumo falhar, a lista ainda aparece.
    //
    // As atribuições de estado acontecem DENTRO do retorno da promessa, nunca
    // no corpo do efeito. Assim o React não é obrigado a renderizar de novo
    // antes de a resposta chegar — e a regra que proíbe `setState` síncrono em
    // efeito continua respeitada.
    void Promise.allSettled([
      apiFetchWithSession<AuthenticatedUser>("/auth/me"),
      apiFetchWithSession<DashboardSummary>("/dashboard/summary"),
      apiFetchWithSession<Paginated<Payment>>("/payments?limit=5"),
    ]).then(([me, summaryResult, paymentsResult]) => {
      // A identidade vem primeiro: sem ela não há tela. E se o erro for de
      // sessão, nem faz sentido tentar desenhar o resto.
      if (me.status === "rejected") {
        const caught: unknown = me.reason;

        if (caught instanceof ApiError && caught.status === 401) {
          // 401 mesmo depois da renovação automática: a sessão acabou.
          void endSession();
          return;
        }

        // Falha que NÃO é de sessão (a API fora do ar, a rede caindo). Aqui não
        // se navega a lugar nenhum: sair seria mentir sobre o que houve.
        setFailure(
          caught instanceof ApiError
            ? caught.message
            : "Não foi possível carregar os seus dados.",
        );
        return;
      }

      setUser(me.value);
      setFailure(null);

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
        setSummaryDenied(false);
      } else if (
        summaryResult.reason instanceof ApiError &&
        summaryResult.reason.status === 403
      ) {
        // 403 é uma resposta legítima, não um erro: o perfil desta pessoa não
        // enxerga números financeiros. A tela explica isso em vez de mostrar
        // uma falha — que faria a pessoa achar que o sistema quebrou.
        //
        // Repare que a proteção de verdade NÃO é esta: é o `RolesGuard` na API.
        // Aqui só se evita pedir uma tela que já se sabe que virá negada.
        setSummary(null);
        setSummaryDenied(true);
      } else {
        setSummary(null);
        setSummaryDenied(false);
      }

      setPayments(
        paymentsResult.status === "fulfilled"
          ? paymentsResult.value.data
          : null,
      );
    });
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
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 p-6">
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

        {/* As saídas do painel e o botão só aparecem quando já se sabe quem
            está logado: enquanto a resposta não chega, não há sessão confirmada
            para encerrar, nem faz sentido oferecer navegação. */}
        {user !== null && (
          <div className="flex shrink-0 items-center gap-4">
            <nav className="flex items-center gap-4">
              <Link
                href="/pagamentos"
                className="text-sm font-medium text-slate-600 underline-offset-4 transition hover:underline"
              >
                Pagamentos
              </Link>
              <Link
                href="/gateways"
                className="text-sm font-medium text-slate-600 underline-offset-4 transition hover:underline"
              >
                Gateways
              </Link>
            </nav>
            <LogoutButton />
          </div>
        )}
      </header>

      {/* Enquanto a identidade não chegou, não se desenha número nenhum. Um
          "R$ 0,00" provisório seria lido como "não vendi nada", que é uma
          informação FALSA. */}
      {user !== null && (
        <>
          {summary !== null ? (
            <SummaryCards summary={summary} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              {summaryDenied
                ? "Os números financeiros do dia aparecem para os perfis Gerente e Financeiro."
                : "Não foi possível carregar os números de hoje."}
            </p>
          )}

          {payments !== null ? (
            <RecentPayments payments={payments} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              Não foi possível carregar os últimos pagamentos.
            </p>
          )}
        </>
      )}
    </main>
  );
}
