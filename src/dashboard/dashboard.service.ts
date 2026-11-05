import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parseDateRange, todayRange } from '../common/date-range.js';
import { Payment } from '../payments/payment.entity.js';
import { DashboardSummaryDto } from './dashboard-summary.dto.js';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto.js';

/**
 * O que o Postgres devolve de um agregado.
 *
 * Repare que TUDO é `string`. Não é engano: `COUNT` e `SUM` no Postgres
 * retornam tipos largos (`bigint`/`numeric`), e o driver `pg` entrega esses
 * tipos como texto para não perder precisão. Se isso passasse direto para o
 * JSON, o front receberia `"12"` no lugar de `12` e a conta sairia errada na
 * tela. Por isso convertemos na fronteira (veja `toInteger`).
 */
interface DashboardAggregate {
  paymentCount: string;
  totalProcessedInCents: string;
  netReceivedInCents: string;
  totalFeesInCents: string;
}

/** Converte o texto do driver em inteiro, caindo para 0 em qualquer surpresa. */
function toInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/**
 * Produz os números do dashboard.
 *
 * POR QUE A CONTA É FEITA NO BANCO, E NÃO NO FRONT.
 *
 * A alternativa seria devolver a lista inteira e somar no navegador. Isso
 * significaria trafegar (e carregar na memória do celular do dono) milhares de
 * registros para exibir quatro números — e o total ficaria errado assim que a
 * lista fosse paginada. `SUM`/`COUNT` no banco devolvem UMA linha com a
 * resposta pronta, independentemente do volume.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
  ) {}

  async summarize(query: DashboardSummaryQueryDto): Promise<DashboardSummaryDto> {
    // Sem `from`/`to` a pergunta é "hoje". Quando uma ponta é informada, ela
    // manda; a outra cai no padrão de hoje.
    const defaults = todayRange();
    const range = parseDateRange(query.from, query.to);
    const from = range.from ?? defaults.from;
    const to = range.to ?? defaults.to;

    const raw = await this.payments
      .createQueryBuilder('payment')
      .select('COUNT(*)', 'paymentCount')
      .addSelect('COALESCE(SUM(payment.amountInCents), 0)', 'totalProcessedInCents')
      .addSelect('COALESCE(SUM(payment.netAmountInCents), 0)', 'netReceivedInCents')
      .addSelect('COALESCE(SUM(payment.totalFeeInCents), 0)', 'totalFeesInCents')
      .where('payment.createdAt >= :from', { from })
      .andWhere('payment.createdAt <= :to', { to })
      .getRawOne<DashboardAggregate>();

    const paymentCount = toInteger(raw?.paymentCount);
    const totalProcessedInCents = toInteger(raw?.totalProcessedInCents);

    return {
      periodStart: from.toISOString(),
      periodEnd: to.toISOString(),
      paymentCount,
      totalProcessedInCents,
      // Ticket médio é divisão, e divisão por zero não existe. Sem vendas no
      // período, o médio é 0 — não `NaN` (que viraria `null` no JSON e
      // quebraria a tela).
      averageTicketInCents:
        paymentCount > 0 ? Math.round(totalProcessedInCents / paymentCount) : 0,
      netReceivedInCents: toInteger(raw?.netReceivedInCents),
      totalFeesInCents: toInteger(raw?.totalFeesInCents),
    };
  }
}
