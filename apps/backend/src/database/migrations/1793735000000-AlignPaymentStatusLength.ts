import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Faz o TIPO da coluna `payments.status` concordar com a entidade.
 *
 * POR QUE ESTA MIGRATION PRECISOU EXISTIR.
 *
 * A entidade `Payment` declara `@Column('varchar', { length: 20 })`, mas a
 * migration inicial criou a coluna como `character varying` SEM comprimento.
 * As duas descreviam a mesma tabela de formas diferentes — e ninguém notou
 * por muito tempo.
 *
 * Em produção esse desencontro é invisível: o `synchronize` está DESLIGADO,
 * então nada compara entidade e banco a cada subida. O sintoma apareceu nos
 * TESTES, que montam o banco de teste por DOIS caminhos: o E2E pelas
 * migrations, os testes de Service pelo `synchronize`. Ao encontrar
 * comprimentos diferentes, o `synchronize` NÃO ajusta a coluna: ele derruba e
 * recria (veja `PostgresQueryRunner.changeColumn`). Com linhas já na tabela,
 * recriar uma coluna `NOT NULL` estoura com "a coluna status contém valores
 * nulos" — que foi o erro que quebrou a suíte.
 *
 * A SAÍDA NÃO É "consertar" a entidade para bater com a falha, e sim fazer o
 * banco concordar com a entidade pelo caminho oficial: uma migration. É o
 * mesmo princípio das outras mudanças de esquema do projeto — o histórico do
 * banco é contado por arquivos versionados, não por ajustes automáticos.
 *
 * É um `ALTER` seguro e sem perda: a coluna é `NOT NULL` (não tem nulos) e
 * nenhum valor existente passa de 20 caracteres — hoje o único status é
 * "approved", com 8.
 */
export class AlignPaymentStatusLength1793735000000
  implements MigrationInterface
{
  name = 'AlignPaymentStatusLength1793735000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" TYPE character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" TYPE character varying`,
    );
  }
}
