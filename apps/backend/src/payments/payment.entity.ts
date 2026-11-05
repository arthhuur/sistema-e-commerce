import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Os status possíveis de um pagamento.
 *
 * Hoje só existe um: tudo nasce e morre "approved". O segundo status só entra
 * quando a cobrança virar uma chamada HTTP de verdade ao gateway (Fase 2) — aí
 * o desfecho "recusado" deixa de ser impossível.
 *
 * É uma LISTA (e não o tipo solto de antes) pelo mesmo motivo de `USER_ROLES`:
 * quem valida a query string precisa do conjunto em TEMPO DE EXECUÇÃO, e um
 * tipo sozinho não existe depois da compilação. O tipo continua existindo,
 * derivado da lista, para o código continuar falando `PaymentStatus`.
 */
export const PAYMENT_STATUSES = ['approved'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Um pagamento já processado.
 *
 * Repare que NÃO guardamos nada do cartão aqui — nem número, nem CVV, nem
 * bandeira. Isso é uma decisão de segurança (PCI-DSS): o dado sensível fica
 * com o gateway, e nós só guardamos o resultado da operação. Se o nosso banco
 * vazar, não vaza cartão de ninguém.
 *
 * Essa decisão virou ainda mais importante agora que os dados moram no
 * Postgres: antes eles sumiam no restart; agora ficam em disco. O que é
 * seguro guardar continua sendo só o RESULTADO da cobrança.
 */
@Entity('payments')
export class Payment {
  /** Mesmo critério do Gateway: texto, para id malformado virar "não achou". */
  @ApiProperty({ description: 'ID único da transação', example: '550e8400-e29b-41d4-a716-446655440000' })
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  /** Valor cobrado, em centavos (inteiro — nunca float). */
  @ApiProperty({ description: 'Valor total cobrado em centavos', example: 10000 })
  @Column('int')
  amountInCents: number;

  /** Moeda ISO-4217, ex.: "BRL". */
  @ApiProperty({ description: 'Moeda da transação', example: 'BRL' })
  @Column('varchar', { length: 3 })
  currency: string;

  /** ID do produto validado com o fornecedor. */
  @ApiProperty({ description: 'ID do produto no fornecedor', example: 'prod-123' })
  @Column('varchar')
  productId: string;

  /** Gateway que processou a cobrança. */
  @ApiProperty({ description: 'ID do gateway que processou o pagamento', example: 'gw-abc' })
  @Column('varchar', { length: 36 })
  gatewayId: string;

  /**
   * Nome do gateway no momento da cobrança.
   *
   * Guardamos o nome "congelado", e não uma referência viva ao gateway. Se o
   * gateway for renomeado ou apagado amanhã, o histórico do pagamento continua
   * contando a verdade de hoje. Registro financeiro não pode mudar de texto
   * depois que aconteceu.
   */
  @ApiProperty({ description: 'Nome do gateway processador', example: 'Mercado Pago' })
  @Column('varchar')
  gatewayName: string;

  /** O que sobrou para o lojista após as taxas. */
  @ApiProperty({ description: 'Valor líquido após taxas do gateway', example: 9552 })
  @Column('int')
  netAmountInCents: number;

  /** Total de taxas pagas ao gateway. */
  @ApiProperty({ description: 'Total de taxas cobradas pelo gateway', example: 448 })
  @Column('int')
  totalFeeInCents: number;

  /** No momento da Fase 1, todos nascem aprovados. */
  @ApiProperty({ description: 'Status atual do pagamento', example: 'approved' })
  @Column('varchar', { length: 20 })
  status: PaymentStatus;

  /** O instante em que o registro foi criado no banco. */
  @ApiProperty({ description: 'Data e hora da criação do registro' })
  @CreateDateColumn()
  createdAt: Date;
}
