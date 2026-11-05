import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona as colunas do segundo fator (TOTP) e a tabela dos códigos de
 * recuperação.
 *
 * A migration é ADITIVA e toda opcional: as duas colunas nascem nulas e a
 * tabela nasce vazia. Isso importa porque ela roda automaticamente na subida
 * (`migrationsRun: true`), inclusive contra o banco de produção que já tem
 * usuários. Nenhum registro existente é invalidado e ninguém é deslogado:
 * quem não tem 2FA simplesmente continua entrando com a senha.
 *
 * AS DUAS COLUNAS EM `users` NÃO SÃO A MESMA COISA:
 *
 *  - `totpSecret`: o segredo do TOTP, CIFRADO (AES-256-GCM). Fica gravado já
 *    na primeira etapa da configuração, antes de o 2FA valer.
 *  - `totpEnabledAt`: quando o 2FA passou a valer. Nulo até a pessoa provar
 *    que o aplicativo autenticador está sincronizado.
 *
 * `recovery_codes` é uma tabela separada — e não uma coluna com uma lista —
 * pela mesma razão de `refresh_tokens`: são MUITOS por usuário, cada um
 * consumido uma vez, e cada consumo precisa deixar rastro. Junta numa coluna,
 * o "usado uma vez só" viraria um texto que alguém precisa interpretar.
 */
export class AddTwoFactorAuth1793730000000 implements MigrationInterface {
  name = 'AddTwoFactorAuth1793730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 512 caracteres comporta com folga o resultado cifrado (versão + IV +
    // tag + texto, em base64url). Apertar aqui seria um bug silencioso só
    // descoberto quando alguém tentasse configurar o 2FA.
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totpSecret" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "totpEnabledAt" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `CREATE TABLE "recovery_codes" (` +
        `"id" character varying(36) NOT NULL, ` +
        `"userId" character varying(36) NOT NULL, ` +
        `"codeHash" character varying(64) NOT NULL, ` +
        `"usedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_recovery_codes" PRIMARY KEY ("id"))`,
    );

    // Índice no dono: a operação "apague os códigos do usuário X" acontece
    // toda vez que ele desliga o 2FA, e seria uma varredura de tabela sem ele.
    await queryRunner.query(
      `CREATE INDEX "IDX_recovery_codes_userId" ON "recovery_codes" ("userId")`,
    );

    // Índice no hash: é por ele que a verificação encontra o código. Sem o
    // índice, cada tentativa de recuperação varreria a tabela inteira.
    await queryRunner.query(
      `CREATE INDEX "IDX_recovery_codes_codeHash" ON "recovery_codes" ("codeHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ordem inversa: primeiro o que foi criado por último, e a tabela nova
    // antes das colunas de `users`.
    await queryRunner.query(`DROP INDEX "IDX_recovery_codes_codeHash"`);
    await queryRunner.query(`DROP INDEX "IDX_recovery_codes_userId"`);
    await queryRunner.query(`DROP TABLE "recovery_codes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totpEnabledAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totpSecret"`);
  }
}
