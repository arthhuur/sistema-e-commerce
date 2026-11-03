import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Um código de recuperação do segundo fator.
 *
 * POR QUE ISSO PRECISA EXISTIR.
 *
 * O 2FA resolve um problema e cria outro. Se o segundo fator é só o aplicativo
 * autenticador, perder o celular significa perder a conta para sempre — não
 * existe "esqueci a senha" que resolva um código de 30 em 30 segundos. Estes
 * códigos são a saída de emergência: um punhado de valores de uso único,
 * mostrados UMA vez, para entrar quando o celular sumir.
 *
 * POR QUE O HASH E NÃO O CÓDIGO.
 *
 * Pela mesma razão da senha e do refresh token: se o banco vazar, os códigos
 * impressos não devem sair junto. Um SHA-256 basta — o código é aleatório e
 * longo, então não há o que adivinhar com força bruta.
 *
 * E POR QUE `usedAt` EM VEZ DE APAGAR A LINHA.
 *
 * Um código de recuperação só serve UMA vez. Marcar o uso em vez de apagar
 * deixa o rastro: dá para dizer "este foi usado em tal momento", o que
 * responde a pergunta que importa quando alguém contesta um acesso.
 */
@Entity('recovery_codes')
export class RecoveryCode {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index()
  @Column('varchar', { length: 36 })
  userId: string;

  /**
   * SHA-256 (hex) do código já normalizado (sem separadores, em maiúsculas).
   * Normalizar ANTES de derivar é o que permite a pessoa digitar o código com
   * ou sem o traço que a tela mostra.
   */
  @Index()
  @Column('varchar', { length: 64 })
  codeHash: string;

  /** `null` = ainda não usado, portanto ainda vale. */
  @Column('timestamptz', { nullable: true })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
