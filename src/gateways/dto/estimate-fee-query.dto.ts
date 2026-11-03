import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Ficha de pedido da estimativa de taxa.
 *
 * Query string chega SEMPRE como texto, então `@Type(() => Number)` converte
 * "10000" em 10000. Se vier algo não numérico (ex.: "abc"), o resultado é NaN
 * e o `@IsInt()` reprova com HTTP 400 — de novo, a validação barra antes da
 * regra de negócio rodar.
 *
 * `@Min(1)` impede valor zero ou negativo: não existe cobrança de R$ 0,00.
 */
export class EstimateFeeQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountInCents: number;
}
