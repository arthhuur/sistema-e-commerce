import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria as tabelas da autenticação.
 *
 * São duas, e a separação é o desenho:
 *
 *  - `users`: quem existe no sistema. Uma linha por pessoa.
 *  - `refresh_tokens`: quais sessões estão abertas. MUITAS linhas por pessoa —
 *    uma para cada dispositivo logado. É essa multiplicidade que permite
 *    "sair de todos os aparelhos" e revogar um acesso específico.
 *
 * Se a sessão morasse em uma coluna de `users`, só existiria um dispositivo
 * por pessoa, e deslogar no celular derrubaria o computador também.
 *
 * REPARE NO QUE NÃO EXISTE AQUI: nenhuma coluna `password`. Só `passwordHash`.
 * O banco nunca guarda a senha, em nenhum momento, nem na criação.
 */
export class AddAuthTables1793728500000 implements MigrationInterface {
  name = 'AddAuthTables1793728500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" (` +
        `"id" character varying(36) NOT NULL, ` +
        `"email" character varying(255) NOT NULL, ` +
        `"passwordHash" character varying(255) NOT NULL, ` +
        `"role" character varying(20) NOT NULL, ` +
        `"active" boolean NOT NULL DEFAULT true, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_users_email" UNIQUE ("email"), ` +
        `CONSTRAINT "PK_users" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (` +
        `"id" character varying(36) NOT NULL, ` +
        `"userId" character varying(36) NOT NULL, ` +
        `"tokenHash" character varying(64) NOT NULL, ` +
        `"expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, ` +
        `"revokedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_refresh_tokens_tokenHash" UNIQUE ("tokenHash"), ` +
        `CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"))`,
    );

    // Índice no dono do token.
    //
    // A consulta mais frequente desta tabela é "derrube todas as sessões do
    // usuário X" (ao desativar alguém, ou ao detectar um token copiado). Sem
    // índice, o banco varreria a tabela inteira a cada uma dessas operações.
    //
    // O índice em `tokenHash` NÃO precisa ser criado aqui: a restrição UNIQUE
    // da coluna já cria um por baixo.
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ordem inversa da criação: primeiro o índice, depois as tabelas, e
    // `refresh_tokens` antes de `users` (ela referencia quem é o dono).
    await queryRunner.query(`DROP INDEX "IDX_refresh_tokens_userId"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
