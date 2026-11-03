import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { UserRole } from './user-role.js';

/**
 * Um usuário do sistema.
 *
 * O QUE **NÃO** EXISTE AQUI, DE PROPÓSITO: a senha.
 *
 * Não existe coluna `password`. Existe `passwordHash`, que guarda o resultado
 * de um algoritmo de derivação (argon2id), do qual NÃO é possível voltar para
 * a senha original. Se o banco vazar, quem leu não consegue fazer login.
 *
 * Colunas para o TOTP (segredo, códigos de recuperação) entram na PRÓXIMA
 * migration, junto com o segundo fator. Elas não estão aqui porque cada
 * mudança de esquema precisa do seu próprio arquivo versionado — juntar tudo
 * agora esconderia do histórico a ordem em que as coisas foram construídas.
 */
@Entity('users')
export class User {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  /**
   * E-mail usado para entrar.
   *
   * `unique` impede dois cadastros com o mesmo endereço. O valor é SEMPRE
   * gravado em minúsculas (o AuthService normaliza antes de salvar): sem
   * isso, "Ana@loja.com" e "ana@loja.com" virariam duas contas diferentes, e
   * a pessoa não entenderia por que a senha "não funciona".
   */
  @Column('varchar', { length: 255, unique: true })
  email: string;

  /**
   * O hash argon2id da senha. Nunca a senha.
   *
   * O tamanho é generoso de propósito: o formato inclui o algoritmo, os
   * parâmetros de custo e o salt, então a string é longa (passa de 90
   * caracteres). Apertar esse campo seria um bug silencioso só descoberto
   * quando alguém tentasse trocar a senha.
   */
  @Column('varchar', { length: 255 })
  passwordHash: string;

  @Column('varchar', { length: 20 })
  role: UserRole;

  /**
   * Desligar o acesso sem apagar o histórico.
   *
   * Apagar a linha do usuário levaria junto o rastro de quem ele foi. Com
   * `active = false` ele para de entrar, mas os registros continuam contando
   * a verdade do passado.
   */
  @Column('boolean', { default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
