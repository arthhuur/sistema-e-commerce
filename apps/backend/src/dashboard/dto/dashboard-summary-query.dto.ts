import { IsDateString, IsOptional } from 'class-validator';

/**
 * Ficha de pedido do resumo do dashboard (o "?" de `GET /dashboard/summary`).
 *
 * Sem parâmetro nenhum, o Service entende "hoje" — que é a pergunta que a tela
 * faz ao abrir. As duas datas são opcionais e seguem a mesma regra da listagem
 * de pagamentos: data sem hora vale o dia inteiro (ver `parseDateRange`).
 */
export class DashboardSummaryQueryDto {
  /** Início do período (ISO 8601). Ex.: `2026-11-01`. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'from deve ser uma data ISO 8601 (ex.: 2026-11-01).' },
  )
  from?: string;

  /** Fim do período (ISO 8601). Ex.: `2026-11-05` = até 05/11 23:59. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'to deve ser uma data ISO 8601 (ex.: 2026-11-05).' },
  )
  to?: string;
}
