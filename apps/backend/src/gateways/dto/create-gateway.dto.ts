import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * A "ficha de pedido" de criação de gateway.
 *
 * Cada etiqueta (@IsString, @Min...) é uma regra que o ValidationPipe cobra
 * ANTES de chegar no Service. Se o cliente errar, recebe erro 400 e a regra
 * de negócio nem é executada.
 */
export class CreateGatewayDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  displayName: string;

  /** Percentual de taxa: aceita de 0 a 100. */
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent: number;

  /** Taxa fixa em centavos: não pode ser negativa. */
  @IsNumber()
  @Min(0)
  feeFixed: number;

  /** Probabilidade de aprovação: de 0 a 1. */
  @IsNumber()
  @Min(0)
  @Max(1)
  approvalRate: number;

  /** Opcional: se não enviado, o Service assume `true`. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
