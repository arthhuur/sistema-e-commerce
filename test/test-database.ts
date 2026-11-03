import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../src/database/database.module.js';

/**
 * O banco em que os testes rodam.
 *
 * É um banco SEPARADO do de desenvolvimento, porque os testes APAGAM as
 * tabelas entre um caso e outro. Apontar isso para o banco de desenvolvimento
 * significaria apagar os seus dados a cada `npm test`.
 *
 * A partir do momento em que o banco de desenvolvimento passou a ser
 * HOSPEDADO (Neon), essa separação deixou de ser só conveniência e virou
 * proteção: apontar a suíte para lá significaria apagar o banco hospedado.
 * Por isso os testes têm o seu PRÓPRIO conjunto de variáveis, com prefixo
 * `POSTGRES_TEST_`, e nunca leem `POSTGRES_URL`/`POSTGRES_SSL`.
 */
export const TEST_DATABASE = process.env.POSTGRES_TEST_DB ?? 'payment_router_test';

/**
 * Os mesmos valores, mas na forma que o `DatabaseModule` entende.
 *
 * O módulo da aplicação lê `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
 * `POSTGRES_PASSWORD` e `POSTGRES_DB` — sem o prefixo. Esta função traduz de um
 * conjunto para o outro, num lugar só, para que a tradução não fique copiada
 * em dois arquivos e saia do ar no dia em que alguém renomear uma variável.
 *
 * `POSTGRES_URL` e `POSTGRES_SSL` são REMOVIDAS de propósito: se sobrassem no
 * ambiente, o `DatabaseModule` preferiria a URL e o E2E conectaria no Neon.
 */
export function pointAppAtTestDatabase(): void {
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_SSL;

  process.env.POSTGRES_HOST = process.env.POSTGRES_TEST_HOST ?? 'localhost';
  process.env.POSTGRES_PORT = process.env.POSTGRES_TEST_PORT ?? '5432';
  process.env.POSTGRES_USER = process.env.POSTGRES_TEST_USER ?? 'payment_router';
  process.env.POSTGRES_PASSWORD =
    process.env.POSTGRES_TEST_PASSWORD ?? 'payment_router';
  process.env.POSTGRES_DB = TEST_DATABASE;
}

/**
 * As opções de conexão usadas tanto pelos testes de Service quanto pelos E2E.
 *
 * Repare que as entidades vêm da MESMA lista que a aplicação usa
 * (`DATABASE_ENTITIES`). Se ficasse duplicada aqui, uma entidade nova passaria
 * desapercebida nos testes — e eles validariam um banco que não existe.
 *
 * `synchronize: true` faz o TypeORM criar as tabelas a partir das entidades.
 * Nos testes isso é exatamente o que queremos: o banco de teste nasce vazio e
 * ganha o formato atual a cada execução.
 */
export function testDatabaseOptions(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: process.env.POSTGRES_TEST_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_TEST_PORT ?? 5432),
    username: process.env.POSTGRES_TEST_USER ?? 'payment_router',
    password: process.env.POSTGRES_TEST_PASSWORD ?? 'payment_router',
    database: TEST_DATABASE,
    entities: DATABASE_ENTITIES,
    synchronize: true,
  };
}

/**
 * Esvazia as tabelas do domínio.
 *
 * Por que isso é necessário agora: na Fase 1 cada teste subia uma app nova e os
 * `Map` em memória começavam vazios — isolamento "de graça". Com o dado em
 * disco, a app nova continua encontrando o que o teste anterior gravou. Este
 * TRUNCATE devolve o isolamento que o `Map` dava.
 *
 * `CASCADE` cobre o caso de uma tabela referenciar outra. `RESTART IDENTITY`
 * não muda nada hoje (nossas chaves primárias são texto), mas deixa o comando
 * correto caso apareça uma coluna `serial`.
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE payments, idempotency_records, gateways RESTART IDENTITY CASCADE',
  );
}
