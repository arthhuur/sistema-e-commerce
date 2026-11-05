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
 * O SEGUNDO FATOR ENTROU DEPOIS, EM MIGRATION PRÓPRIA. Cada mudança de
 * esquema tem o seu arquivo versionado; juntar tudo de uma vez esconderia do
 * histórico a ordem em que as coisas foram construídas.
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

  /**
   * O segredo do TOTP (segundo fator), CIFRADO. `null` = a pessoa não
   * começou a configurar o 2FA.
   *
   * `select: false` é a decisão mais importante desta coluna: por padrão, ele
   * NÃO vem nas consultas. Só quem pede explicitamente o recebe. Assim um
   * `find()` distraído — ou um `return user` num controller — não coloca o
   * segredo do segundo fator no JSON, do mesmo jeito que o `passwordHash` é
   * mantido fora do DTO de saída. Custa uma linha a mais na leitura e elimina
   * uma classe inteira de vazamento.
   *
   * O valor guardado é o resultado de `encryptSecret`, não o segredo em si:
   * veja o comentário em `secret-cipher.ts`.
   */
  @Column('varchar', { length: 512, nullable: true, select: false })
  totpSecret: string | null;

  /**
   * Quando o segundo fator passou a valer. `null` = ainda não confirmado.
   *
   * A DISTINÇÃO ENTRE ESTA COLUNA E A DE CIMA É O FLUXO INTEIRO. Configurar o
   * 2FA acontece em dois tempos: (1) a API gera e grava o segredo e devolve o
   * QR Code; (2) a pessoa escaneia e digita um código para provar que o
   * aplicativo está sincronizado — só então o 2FA passa a valer.
   *
   * Sem essa segunda etapa, um QR Code mal escaneado (ou uma configuração
   * abandonada no meio) trancaria a pessoa fora da própria conta, com um
   * segredo que ela nunca conseguiu guardar.
   */
  @Column('timestamptz', { nullable: true })
  totpEnabledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
