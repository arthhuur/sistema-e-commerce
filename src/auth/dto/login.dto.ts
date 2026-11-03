import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Os dados de entrada do login.
 *
 * Repare nos limites de tamanho: eles não são preciosismo. O argon2 deriva a
 * senha de propósito devagar, e essa lentidão é a defesa. Se alguém enviar
 * uma "senha" de 5 MB, o servidor gastaria segundos de CPU para recusá-la —
 * e algumas dezenas dessas requisições derrubariam a API. O teto corta esse
 * caminho antes de o hash começar.
 */
export class LoginDto {
  @ApiProperty({
    description: 'E-mail cadastrado do usuário.',
    example: 'gerente@loja.com',
  })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'Senha do usuário.',
    example: 'uma-senha-forte',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'A senha deve ter ao menos 8 caracteres.' })
  @MaxLength(128)
  password: string;
}
