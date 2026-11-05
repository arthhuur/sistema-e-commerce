import type { DashboardSummary } from "@payment-router/shared";
import { formatBRL } from "@/lib/format";

/**
 * Os quatro números da operação.
 *
 * A REGRA DO PROJETO É "UMA PERGUNTA POR TELA", e o dashboard responde à
 * primeira: "como está o movimento de hoje?". Por isso são QUATRO cartões e
 * nada mais — gráfico, comparativo e filtro ficam para depois que esses
 * números provarem que a tela faz sentido.
 *
 * NENHUMA CONTA ACONTECE AQUI. Tudo chega somado do `GET /dashboard/summary`:
 * a tela só formata. Somar no front daria um número que o banco não confirma,
 * e ele divergiria do extrato no primeiro dia — o tipo de erro que destrói a
 * confiança na tela inteira.
 *
 * Este componente é só apresentação: recebe o resumo e desenha. Não busca
 * dado, não guarda estado. Assim ele pode ser reaproveitado (num relatório,
 * num print) sem arrastar junto uma chamada de rede.
 */
export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Total processado hoje"
        value={formatBRL(summary.totalProcessedInCents)}
      />
      <Card label="Vendas aprovadas" value={String(summary.paymentCount)} />
      <Card
        label="Ticket médio"
        value={formatBRL(summary.averageTicketInCents)}
      />
      <Card
        label="Líquido recebido"
        value={formatBRL(summary.netReceivedInCents)}
        // Esta legenda é o que separa "quanto entrou" de "quanto sobrou".
        // Sem ela, o líquido menor que o total pareceria erro de soma.
        hint={`após ${formatBRL(summary.totalFeesInCents)} em taxas`}
      />
    </section>
  );
}

/** Um cartão do resumo: o rótulo, o número grande e uma legenda opcional. */
function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint !== undefined && (
        <p className="mt-1 text-xs text-slate-400">{hint}</p>
      )}
    </article>
  );
}
