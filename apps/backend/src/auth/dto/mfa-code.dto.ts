import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * O código do segundo fator, seja do aplicativo (6 dígitos) ou de recuperação
 * (10 caracteres).
 *
 * UM DTO SÓ PARA OS DOIS DE PROPÓSITO. A API tenta os dois tipos na mesma
 * chamada — é o que permite a pessoa digitar o código de recuperação na mesma
 * tela, sem escolher antes "estou usando recuperação". Um campo só, uma
 * tentativa só, um caminho só.
 *
 * O limite de tamanho não é preciosismo: ele corta um corpo gigante antes de
 * qualquer cálculo, como no login.
 */
export class MfaCodeDto {
  @ApiProperty({
    description:
      'Código de 6 dígitos do aplicativo autenticador, ou um código de recuperação.',
    example: '123456',
    minLength: 6,
    maxLength: 32,
  })
  @IsString()
  @MinLength(6, { message: 'O código deve ter ao menos 6 caracteres.' })
  @MaxLength(32)
  code: string;
}
