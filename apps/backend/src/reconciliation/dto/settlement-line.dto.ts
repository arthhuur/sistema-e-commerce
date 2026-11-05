import { IsIn, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import type { SettlementLine, SettlementStatus } from '../settlement-line.js';

/**
 * Validação de UMA linha do extrato.
 *
 * `implements SettlementLine` é de propósito: o TypeScript passa a exigir que
 * este DTO tenha exatamente os campos do tipo de domínio. Se alguém adicionar
 * um campo no domínio e esquecer aqui, o build quebra — em vez de a diferença
 * aparecer só em produção.
 */
export class SettlementLineDto implements SettlementLine {
  @IsString()
  @IsNotEmpty()
  externalReference: string;

  @IsInt()
  @Min(1)
  amountInCents: number;

  @IsInt()
  @Min(0)
  totalFeeInCents: number;

  // Sem @Min(0) de propósito: o líquido PODE ser negativo.
  // É o caso da taxa que engole uma transação pequena (a taxa fixa de 49c
  // numa cobrança de 50c deixa o lojista devendo 1 centavo). Isso é uma
  // informação legítima e precisa passar pela validação, não ser barrada.
  @IsInt()
  netAmountInCents: number;

  @IsIn(['approved', 'declined'])
  status: SettlementStatus;
}
