import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { PaymentsExplorer } from "@/components/payments-explorer";

export const metadata: Metadata = {
  title: "Pagamentos · Payment Router",
};

/**
 * O extrato da operação.
 *
 * POR QUE ESTA PÁGINA É DE SERVIDOR, E A LISTA NÃO.
 *
 * O cabeçalho (título e link de volta) não depende de sessão nem de dado
 * nenhum — então ele sai pronto do servidor, e o navegador já desenha a
 * moldura antes de a primeira resposta da API chegar. Só a parte que precisa
 * do cookie e do dado da API (`PaymentsExplorer`) é de cliente.
 *
 * O `<Suspense>` NÃO É DECORAÇÃO: o `useSearchParams` da lista obriga o Next a
 * adiar a renderização desse pedaço até saber a query string. Sem este limite,
 * a página inteira ficaria presa; com ele, só a lista espera — e enquanto
 * isso o `fallback` já ocupa o lugar.
 */
export default function PaymentsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pagamentos</h1>
          <p className="text-sm text-slate-500">
            O histórico do livro caixa, do mais recente para o mais antigo.
          </p>
        </div>

        <Link
          href="/painel"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Voltar ao painel
        </Link>
      </header>

      <Suspense fallback={<p className="text-sm text-slate-500">Carregando…</p>}>
        <PaymentsExplorer />
      </Suspense>
    </main>
  );
}
