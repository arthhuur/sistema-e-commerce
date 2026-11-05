import Link from "next/link";
import type { Metadata } from "next";
import { GatewaysExplorer } from "@/components/gateways-explorer";

export const metadata: Metadata = {
  title: "Gateways · Payment Router",
};

/**
 * Os gateways e o quanto cada um custa.
 *
 * POR QUE ESTA PÁGINA É DE SERVIDOR, E A LISTA NÃO.
 *
 * O cabeçalho (título e link de volta) não depende de sessão nem de dado
 * nenhum, então sai pronto do servidor e a moldura aparece antes da primeira
 * resposta da API. Só a parte que precisa do cookie e da chamada
 * (`GatewaysExplorer`) é de cliente — mesmo desenho da tela de pagamentos.
 *
 * AQUI NÃO HÁ `<Suspense>`, E ISSO É DE PROPÓSITO. Aquele limite existe para
 * segurar a renderização de quem lê a query string (`useSearchParams`) sem
 * travar a página inteira. Esta tela ainda não tem filtro nem paginação, então
 * ninguém lê a URL — e um `<Suspense>` sem esse motivo seria só cerimônia.
 * Quando o filtro de ativos entrar, ele volta, pelo mesmo motivo de pagamentos.
 */
export default function GatewaysPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Gateways</h1>
          <p className="text-sm text-slate-500">
            Por onde o dinheiro entra — e quanto cada caminho custa.
          </p>
        </div>

        <Link
          href="/painel"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Voltar ao painel
        </Link>
      </header>

      <GatewaysExplorer />
    </main>
  );
}
