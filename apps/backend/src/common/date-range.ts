/**
 * Traduz o par `from`/`to` de uma query string em datas de verdade.
 *
 * POR QUE ISTO É UM ARQUIVO SEPARADO.
 *
 * Duas features precisam da MESMA regra: a listagem paginada de pagamentos
 * (`GET /payments`) e o resumo do dashboard (`GET /dashboard/summary`). Se cada
 * uma interpretasse o período do seu jeito, o filtro de uma traria um número e
 * o cartão da outra traria outro — para o mesmo dia. Regra duplicada vira
 * divergência.
 *
 * A REGRA.
 *
 * - `from` é o COMEÇO do período; `to` é o FIM.
 * - Data sem hora ("2026-11-05") vale o DIA INTEIRO: `from` vira 00:00:00.000
 *   e `to` vira 23:59:59.999, no fuso do servidor.
 *
 * Esse último ponto evita o erro clássico do filtro por dia. Sem ele,
 * `?to=2026-11-05` significaria "até 05/11 às 00:00" e quem consultasse
 * perderia TODAS as vendas daquele dia — justamente o dia que pediu para
 * incluir.
 */

/** Uma data só com o dia, sem hora — ex.: "2026-11-05". */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Lê UMA ponta do período.
 *
 * `edge` só importa quando o texto não traz hora: diz se aquela data vira o
 * começo ou o fim do dia.
 */
function parseBoundary(
  value: string | undefined,
  edge: 'start' | 'end',
): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (DATE_ONLY.test(value)) {
    // `new Date("2026-11-05")` seria meia-noite em UTC — que, no Brasil
    // (UTC-3), é 21h do dia ANTERIOR. Construir pelos campos
    // (`new Date(2026, 10, 5)`) dá meia-noite no fuso do servidor, que é o
    // que "o dia 05" significa na operação.
    const [year, month, day] = value.split('-');
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (edge === 'end') {
      date.setHours(23, 59, 59, 999);
    }
    return date;
  }

  return new Date(value);
}

export function parseDateRange(from?: string, to?: string): DateRange {
  return {
    from: parseBoundary(from, 'start'),
    to: parseBoundary(to, 'end'),
  };
}

/**
 * O começo e o fim do dia de HOJE, no fuso do servidor.
 *
 * É o período padrão do dashboard: quem abre a tela quer "o hoje", não "o
 * desde sempre".
 */
export function todayRange(): { from: Date; to: Date } {
  const now = new Date();

  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}
