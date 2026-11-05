import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { SettlementLineDto } from './settlement-line.dto.js';

/**
 * Validação de uma LISTA de objetos — o caso mais chato (e mais esquecido)
 * do class-validator.
 *
 * Duas armadilhas aqui, e as duas dão erro silencioso:
 *
 * 1) `@ValidateNested({ each: true })` sozinho NÃO basta. O ValidationPipe
 *    recebe os itens como objetos comuns (sem classe). O decorator olha para
 *    eles, não encontra metadados e simplesmente passa batido — você acha que
 *    validou e não validou nada.
 *
 * 2) O `@Type(() => SettlementLineDto)` é a peça que faltava: ele diz ao
 *    class-transformer "transforme cada item nesta CLASSE". Só assim os
 *    decorators de dentro do SettlementLineDto ganham vida.
 *
 * Regra prática: sempre que um DTO tiver outra classe dentro, use os dois
 * juntos — `@ValidateNested({ each: true })` + `@Type(...)`.
 */
export class RunReconciliationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementLineDto)
  lines: SettlementLineDto[];
}
