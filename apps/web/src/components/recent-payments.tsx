import Link from "next/link";
import type { Payment } from "@payment-router/shared";
import { formatBRL, formatDateTime } from "@/lib/format";

/**
 * Os cinco últimos pagamentos.
 *
 * É o nível 2 de informação espiando no nível 1: poucas linhas, o essencial de
 * cada uma, e o registro completo fica para a tela de pagamentos. Mostrar mais
 * campos aqui transformaria o resumo num extrato — e o resumo existe justamente
 * para não ser um extrato.
 *
 * A lista chega pronta do `GET /payments?limit=5`: já vem do mais recente para
 * o mais antigo, e a tela não ordena nada.
 */
export function RecentPayments({ payments }: { payments: Payment[] }) {
  // Lista vazia não é erro — é um dia sem venda. A tela precisa dizer isso com
  // todas as letras, senão o vazio parece uma falha de carregamento.
  if (payments.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-700">
          Últimos pagamentos
        </h2>
        <p className="mt-3 text-sm text-slate-500">
          Nenhum pagamento registrado ainda.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-medium text-slate-700">Últimos pagamentos</h2>

        {/* O resumo mostra cinco; o resto mora no extrato. Sem este link, a
            outra tela existiria sem ninguém saber. */}
        <Link
          href="/pagamentos"
          className="text-sm font-medium text-slate-600 underline-offset-4 transition hover:underline"
        >
          Ver todos
        </Link>
      </div>

      <ul className="divide-y divide-slate-100">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              {/* `truncate` protege o layout: um nome de produto comprido não
                  deve empurrar o valor para fora da linha. */}
              <p className="truncate text-sm font-medium text-slate-800">
                {payment.productId}
              </p>
              <p className="text-xs text-slate-500">
                {payment.gatewayName} · {formatDateTime(payment.createdAt)}
              </p>
            </div>

            <p className="shrink-0 text-sm font-semibold">
              {formatBRL(payment.amountInCents)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
