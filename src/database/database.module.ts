import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Gateway } from '../gateways/gateway.entity.js';
import { Payment } from '../payments/payment.entity.js';
import { IdempotencyRecord } from '../payments/idempotency-record.js';

/**
 * A lista de entidades que existem no banco.
 *
 * Está exportada porque os testes precisam dela: eles sobem o TypeORM contra o
 * banco de teste e têm que enxergar exatamente as mesmas tabelas que a
 * aplicação. Se ficasse duplicada lá, uma entidade nova aqui passaria
 * desapercebida nos testes — e eles começariam a validar um banco inexistente.
 */
export const DATABASE_ENTITIES = [Gateway, Payment, IdempotencyRecord];

/**
 * Centraliza a conexão com o Postgres.
 *
 * O QUE MUDOU NA FASE 2: até aqui cada Service tinha o seu próprio `Map`. Os
 * dados sumiam a cada reinício e dois servidores não enxergavam os mesmos
 * dados. Agora existe UMA conexão (um "pool") compartilhada por todos.
 *
 * Por que as variáveis vêm de `process.env` e não do `ConfigService`?
 * Porque o `.env` já foi carregado para `process.env` pelo `ConfigModule`
 * (declarado no AppModule) antes deste módulo ser instanciado, e ler daqui é
 * previsível: o que estiver em `process.env` no momento da conexão é o que
 * vale. Nos testes, isso é o que nos deixa apontar a conexão para o banco de
 * teste simplesmente ajustando a variável antes de subir a aplicação.
 */

/**
 * Monta as opções de conexão a partir do ambiente.
 *
 * Existem DUAS formas de apontar para o banco, e a razão de serem duas:
 *
 *  1. `POSTGRES_URL` — uma string de conexão única. É o formato que os
 *     serviços gerenciados (Neon, Supabase, Railway) entregam prontos no
 *     painel. Eles fornecem assim porque a senha gerada costuma ter
 *     caracteres especiais; colada em cinco variáveis separadas, seria fácil
 *     quebrar a URL ou escapar a senha errado.
 *  2. `POSTGRES_HOST`/`POSTGRES_PORT`/... — os campos soltos, que é o que faz
 *     sentido no banco local, onde digitar a URL inteira toda vez seria pior.
 *
 * Se a URL existir, ela ganha e os campos soltos são ignorados.
 */
export function databaseOptions(): TypeOrmModuleOptions {
  const url = process.env.POSTGRES_URL;
  const migrations =
    process.env.NODE_ENV === 'production'
      ? ['dist/database/migrations/*.js']
      : ['src/database/migrations/*.ts'];

  return {
    type: 'postgres',
    entities: DATABASE_ENTITIES,
    // MUDANÇA: synchronize desligado. Agora as mudanças no banco são feitas
    // via arquivos de migration (gerados com `npm run migration:generate`).
    // `migrationsRun: true` faz a API aplicar as migrations pendentes ao subir.
    synchronize: false,
    migrationsRun: true,
    migrations,

    ...(url
      ? { url }
      : {
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          username: process.env.POSTGRES_USER ?? 'payment_router',
          password: process.env.POSTGRES_PASSWORD ?? 'payment_router',
          database: process.env.POSTGRES_DB ?? 'payment_router',
        }),

    // Banco gerenciado só aceita conexão criptografada; o local não usa TLS.
    //
    // Repare que a chave `ssl` só é INCLUÍDA quando pedimos. Não é detalhe de
    // estilo: passar `ssl: false` desligaria o TLS mesmo que a URL trouxesse
    // `sslmode=require` (e a URL do Neon traz), derrubando a conexão.
    //
    // `rejectUnauthorized: false` aceita o certificado sem checar a cadeia
    // inteira. É o ajuste que os guias dos provedores usam e o que evita o
    // erro `SELF_SIGNED_CERT_IN_CHAIN`, mas significa que não validamos
    // totalmente quem está do outro lado. Para um projeto de estudo é um
    // trade-off aceitável; em produção daria para fixar o certificado da CA.
    ...(process.env.POSTGRES_SSL === 'true'
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: databaseOptions,
    }),
  ],
})
export class DatabaseModule {}
