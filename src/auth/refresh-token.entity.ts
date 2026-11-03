import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Um refresh token emitido para um usuário.
 *
 * POR QUE ISSO EXISTE.
 *
 * O token de acesso é curto (15 minutos) justamente para que, se vazar, ele
 * sirva de pouco. Mas alguém precisa renovar a sessão quando ele vence — e é
 * esse o papel do refresh token.
 *
 * Enquanto o token de acesso é autossuficiente (basta a assinatura para
 * valer), o refresh token precisa ser CONSULTADO no banco. É isso que o
 * torna revogável: apagar esta linha derruba a sessão na hora, coisa que um
 * token assinado não permite.
 *
 * POR QUE GUARDAMOS O HASH E NÃO O TOKEN.
 *
 * Pela mesma razão da senha: se o banco vazar, o atacante não deve sair com
 * uma sessão pronta. Aqui basta um SHA-256 (e não argon2) porque o token é
 * aleatório de 256 bits — não é adivinhável, então não precisa de um custo
 * artificial para dificultar a força bruta. Guardar o SHA-256 permite
 * CONFERIR o token, mas não RECONSTRUÍ-LO.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index()
  @Column('varchar', { length: 36 })
  userId: string;

  /**
   * SHA-256 (hex) do token. `unique` evita que uma colisão de geração crie
   * duas sessões válidas com o mesmo identificador.
   */
  @Column('varchar', { length: 64, unique: true })
  tokenHash: string;

  @Column('timestamptz')
  expiresAt: Date;

  /**
   * Quando este token foi revogado. `null` = ainda vale.
   *
   * A ROTAÇÃO marca o token antigo como revogado em vez de apagá-lo. Isso
   * deixa um rastro: se um token já revogado for reapresentado, é sinal de
   * que alguém copiou o cookie — e aí a resposta certa é derrubar TODAS as
   * sessões daquele usuário, não só recusar a requisição.
   */
  @Column('timestamptz', { nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
