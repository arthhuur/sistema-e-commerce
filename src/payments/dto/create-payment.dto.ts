import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * Corpo do POST /payments.
 *
 * Note que NÃO existe campo de cartão aqui — de propósito. O dado sensível vai
 * direto do navegador para o gateway (tokenização). O nosso servidor só recebe
 * o valor, e isso é o que nos mantém fora do escopo mais pesado do PCI-DSS.
 *
 * A Idempotency-Key NÃO entra no DTO porque ela é um CABEÇALHO HTTP
 * (@Headers), não um campo do corpo.
 */
export class CreatePaymentDto {
  @ApiProperty({
    description: 'Valor cobrado em centavos (ex: 10000 para R$ 100,00)',
    example: 10000,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  amountInCents: number;

  @ApiProperty({
    description: 'ID do produto no fornecedor (Dropshipping)',
    example: 'prod-123-abc',
  })
  @IsString()
  @IsNotEmpty()
  productId: string;

  /** Opcional. Se não vier, o Service assume "BRL". */
  @ApiPropertyOptional({
    description: 'Moeda da transação (ISO-4217)',
    example: 'BRL',
    default: 'BRL',
    minLength: 3,
    maxLength: 3,
  })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
