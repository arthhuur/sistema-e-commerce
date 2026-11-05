import { IsInt, Min } from 'class-validator';

/**
 * Ficha de pedido para decidir o roteamento.
 *
 * Contraste importante com o EstimateFeeQueryDto:
 * - Na QUERY STRING, tudo chega como texto -> precisa de @Type(() => Number).
 * - No CORPO (JSON), o número já chega como número -> basta @IsInt().
 * Entender essa diferença evita o bug clássico de "10000" !== 10000.
 */
export class DecideRouteDto {
  @IsInt()
  @Min(1)
  amountInCents: number;
}
