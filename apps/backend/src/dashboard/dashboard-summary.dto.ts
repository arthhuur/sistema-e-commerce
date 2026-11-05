import { ApiProperty } from '@nestjs/swagger';

/**
 * O resumo que o dashboard mostra.
 *
 * HONESTIDADE DO NÚMERO — por que não há "taxa de aprovação" nem "pedidos sem
 * estoque" aqui.
 *
 * O rascunho do roadmap previa esses dois cartões. O problema é que, hoje, os
 * dados para preenchê-los NÃO EXISTEM:
 *
 * - Todo pagamento gravado tem `status = 'approved'` — a cobrança ainda é
 *   simulada. Uma "taxa de aprovação" seria sempre 100%: um número inventado
 *   que parece informação.
 * - Pedido sem estoque é recusado com 422 e NÃO é persistido (veja
 *   `PaymentsService.create`). Não há linha para contar, então o alerta seria
 *   sempre 0.
 *
 * Preferimos devolver cinco números REAIS a inventar dois. Os cartões
 * adiados voltam quando existir status de verdade (Fase 2) e quando o estoque
 * virar uma entidade (Fase 4).
 */
export class DashboardSummaryDto {
  @ApiProperty({
    description: 'Início do período considerado (ISO 8601).',
    example: '2026-11-05T03:00:00.000Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'Fim do período considerado (ISO 8601).',
    example: '2026-11-06T02:59:59.999Z',
  })
  periodEnd: string;

  @ApiProperty({
    description: 'Quantidade de pagamentos aprovados no período.',
    example: 12,
  })
  paymentCount: number;

  @ApiProperty({
    description: 'Soma do valor cobrado dos clientes, em centavos.',
    example: 145000,
  })
  totalProcessedInCents: number;

  @ApiProperty({
    description: 'Ticket médio do período, em centavos (arredondado).',
    example: 12083,
  })
  averageTicketInCents: number;

  @ApiProperty({
    description: 'Quanto sobrou para o lojista depois das taxas, em centavos.',
    example: 138552,
  })
  netReceivedInCents: number;

  @ApiProperty({
    description: 'Total pago em taxas aos gateways, em centavos.',
    example: 6448,
  })
  totalFeesInCents: number;
}
