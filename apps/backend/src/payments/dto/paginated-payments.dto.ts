import { ApiProperty } from '@nestjs/swagger';
import { Payment } from '../payment.entity.js';

/**
 * O envelope da listagem paginada.
 *
 * POR QUE NÃO DEVOLVER SÓ A LISTA.
 *
 * Quem mostra uma lista precisa saber o tamanho TOTAL para desenhar a
 * paginação ("1 de 40 páginas"). Se a API devolvesse apenas as 20 linhas, o
 * front teria que adivinhar — ou pedir tudo de novo. O envelope carrega a
 * resposta do banco: `total` é a contagem real do que casou com o filtro.
 *
 * `page` e `limit` voltam na resposta de propósito: com valores padrão
 * aplicados no servidor, o front precisa saber QUAL página o servidor de fato
 * usou quando ele não pediu nenhuma.
 *
 * Esta classe existe para o Swagger. O Service devolve um objeto simples com
 * os mesmos campos — o contrato é o mesmo.
 */
export class PaginatedPaymentsDto {
  @ApiProperty({
    type: [Payment],
    description: 'Os pagamentos daquela página, do mais recente para o mais antigo.',
  })
  data: Payment[];

  @ApiProperty({
    description: 'Quantidade total de registros que casaram com o filtro (não só os da página).',
    example: 143,
  })
  total: number;

  @ApiProperty({ description: 'Página devolvida.', example: 1 })
  page: number;

  @ApiProperty({ description: 'Tamanho da página aplicado pelo servidor.', example: 20 })
  limit: number;
}
