import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { pointAppAtTestDatabase, truncateAll } from './test-database.js';

/**
 * Sobe uma aplicação Nest COMPLETA, em memória, sem abrir porta de rede.
 *
 * Detalhes que importam:
 * - `createNestApplication()` + `app.init()` sobe o app inteiro, mas sem
 *   `listen()` — nada fica escutando em porta nenhuma. O supertest conversa
 *   direto com o servidor HTTP interno. Por isso o E2E é rápido e pode rodar
 *   em paralelo sem conflito de porta.
 * - `configureApp(app)` é a MESMA função usada no main.ts. Sem ela, os
 *   decorators de validação dos DTOs não teriam efeito aqui.
 *
 * O QUE MUDOU NA FASE 2 — o banco de teste.
 * Dois ajustes, nesta ordem, e a ordem é o segredo:
 *
 *  1. Apontamos o ambiente para o banco de TESTE ANTES de construir o módulo.
 *     O `DatabaseModule` lê `process.env` no instante em que abre a conexão;
 *     como o `ConfigModule` não sobrescreve variável que já existe no
 *     ambiente, o valor que definirmos aqui é o que vale.
 *  2. Depois de subir a app, esvaziamos as tabelas. Antes, cada teste subia uma
 *     app nova e os `Map` em memória começavam vazios — o isolamento vinha de
 *     graça. Agora o dado fica em disco e sobrevive ao teste anterior, então
 *     precisamos devolver esse isolamento na mão.
 *
 * O passo 1 virou OBRIGATÓRIO depois que o banco de desenvolvimento passou a
 * ser hospedado: sem ele, o E2E abriria conexão com o Neon e o TRUNCATE do
 * passo 2 apagaria o banco hospedado. É `pointAppAtTestDatabase()` quem corta
 * esse caminho — veja o comentário dela em `test-database.ts`.
 */
export async function createTestApp(): Promise<INestApplication<App>> {
  pointAppAtTestDatabase();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  await truncateAll(app.get(DataSource));

  return app;
}
