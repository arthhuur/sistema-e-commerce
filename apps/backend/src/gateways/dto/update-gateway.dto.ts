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
 * Ficha de pedido para ATUALIZAR um gateway (PATCH).
 *
 * Todos os campos são opcionais: quem faz PATCH envia só o que quer mudar.
 * (Existe o helper `PartialType` que gera isso automaticamente a partir do
 * CreateGatewayDto, mas escrever na mão deixa o aprendizado mais claro.)
 */
export class UpdateGatewayDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  displayName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  feeFixed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  approvalRate?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
