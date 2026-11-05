import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Ficha de pedido para QUERY STRING (o que vem depois do "?" na URL).
 *
 * DETALHE CRÍTICO: todo valor de query string chega como TEXTO.
 * `?active=false` chega como a string "false" — e, em JavaScript, qualquer
 * texto não-vazio é "truthy" (`if ("false")` é verdadeiro!).
 * Se dependêssemos só disso, pedir "só inativos" traria os ativos. Por isso o
 * @Transform abaixo converte o texto em boolean de verdade.
 *
 * Usar um DTO de query (em vez de ler a string na mão no Controller) mantém a
 * validação no mesmo lugar de todas as outras entradas da API.
 */
export class ListGatewaysQueryDto {
  /**
   * - "true"  -> true
   * - "false" -> false
   * - outra coisa (ex.: "banana") -> devolvemos o texto original para que o
   *   @IsBoolean() reprove e o cliente receba HTTP 400.
   * - ausente -> undefined, e o Service entende como "não filtre".
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;
}
