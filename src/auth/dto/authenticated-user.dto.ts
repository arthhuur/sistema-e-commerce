import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES } from '../user-role.js';
import type { UserRole } from '../user-role.js';

/**
 * O que a API devolve sobre um usuário logado.
 *
 * ESTA CLASSE EXISTE PARA NÃO VAZAR O HASH DA SENHA.
 *
 * É tentador devolver a entidade `User` direto do controller — ela já tem
 * tudo. Mas ela também tem `passwordHash`. Um `return user` ingênuo colocaria
 * o hash da senha no JSON, e ele iria para o log do servidor, para o histórico
 * do navegador e para qualquer print de tela.
 *
 * Declarar o que sai é mais seguro do que lembrar do que não pode sair.
 */
export class AuthenticatedUserDto {
  @ApiProperty({ example: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' })
  id: string;

  @ApiProperty({ example: 'gerente@loja.com' })
  email: string;

  @ApiProperty({ enum: USER_ROLES, example: 'gerente' })
  role: UserRole;
}
