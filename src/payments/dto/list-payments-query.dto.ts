import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PAYMENT_STATUSES, type PaymentStatus } from '../payment.entity.js';

/**
 * Ficha de pedido da LISTAGEM de pagamentos (o que vem depois do "?" em
 * `GET /payments`).
 *
 * DETALHE CRÍTICO: todo valor de query string chega como TEXTO. `?page=2` chega
 * como a string "2", não como o número 2. O `@Type(() => Number)` converte; se
 * vier algo não numérico (ex.: "abc"), o resultado é NaN e o `@IsInt()` reprova
 * com HTTP 400 — a validação barra ANTES da consulta rodar. É o mesmo padrão já
 * usado em `EstimateFeeQueryDto`.
 *
 * `page` e `limit` são OPCIONAIS aqui e ganham padrão no Service (1 e 20). Sem
 * um teto em `limit`, um `?limit=999999` traria o banco inteiro de volta e
 * desfaria justamente o que a paginação veio resolver.
 */
export class ListPaymentsQueryDto {
  /** Página pedida, começando em 1. Padrão: 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page deve ser um número inteiro.' })
  @Min(1, { message: 'page deve ser no mínimo 1.' })
  page?: number;

  /** Tamanho da página. Padrão: 20. Teto: 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro.' })
  @Min(1, { message: 'limit deve ser no mínimo 1.' })
  @Max(100, { message: 'limit deve ser no máximo 100.' })
  limit?: number;

  /**
   * Filtra por status. Hoje só existe `approved`, e a lista `PAYMENT_STATUSES`
   * é a fonte da verdade — mandar um status inventado devolve 400 em vez de
   * uma lista vazia que pareceria "não há nada".
   */
  @IsOptional()
  @IsIn(PAYMENT_STATUSES, {
    message: `status deve ser um destes: ${PAYMENT_STATUSES.join(', ')}.`,
  })
  status?: PaymentStatus;

  /** Início do período (ISO 8601). Ex.: `2026-11-01` = a partir de 01/11 00:00. */
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
