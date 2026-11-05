import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IdempotencyService } from './idempotency.service.js';
import { IdempotencyRecord } from './idempotency-record.js';
import { testDatabaseOptions, truncateAll } from '../../test/test-database.js';

/**
 * Testes do caderno de etiquetas.
 *
 * O QUE MUDOU NA FASE 2 — o teste deixou de ser "instância solta".
 * Antes bastava `new IdempotencyService()`, porque a classe não dependia de
 * ninguém: o caderno era um `Map` dentro dela. Agora o caderno é a tabela
 * `idempotency_records`, e a classe recebe um `Repository` pelo construtor.
 * Continuamos testando só ESTA classe — não subimos HTTP nem a app inteira —
 * mas precisamos de uma conexão real com o banco de teste para existir o
 * repositório.
 *
 * Não é papel deste teste provar que o Postgres garante unicidade (isso é do
 * banco). É papel dele provar as REGRAS da classe: reservar, recusar corpo
 * diferente, recusar corrida, replicar resposta e liberar reserva.
 */
describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let module: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(testDatabaseOptions()),
        TypeOrmModule.forFeature([IdempotencyRecord]),
      ],
      providers: [IdempotencyService],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    dataSource = module.get<DataSource>(DataSource);
  });

  // Antes era "instância nova a cada teste". Agora é "tabela vazia a cada
  // teste": cumpre o mesmo papel de não deixar estado vazar entre casos.
  beforeEach(async () => {
    await truncateAll(dataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  it('na primeira vez reserva a chave e libera o processamento', async () => {
    const result = await service.begin('key-1', { amountInCents: 100 });

    expect(result.replayed).toBe(false);
  });

  it('na segunda vez, com o mesmo corpo, devolve a resposta guardada', async () => {
    await service.begin('key-1', { amountInCents: 100 });
    await service.complete('key-1', { id: 'pay_1' }, 201);

    const result = await service.begin('key-1', { amountInCents: 100 });

    expect(result.replayed).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.response).toEqual({ id: 'pay_1' });
  });

  it('recusa a mesma chave com corpo diferente (HTTP 422)', async () => {
    await service.begin('key-1', { amountInCents: 100 });

    await expect(
      service.begin('key-1', { amountInCents: 999 }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('recusa uma segunda chamada enquanto a primeira está em andamento (409)', async () => {
    await service.begin('key-1', { amountInCents: 100 });

    // Não chamamos complete(): a chave continua "in_progress".
    // É exatamente o que acontece quando duas requisições chegam juntas.
    await expect(
      service.begin('key-1', { amountInCents: 100 }),
    ).rejects.toThrow(ConflictException);
  });

  it('esquece a reserva depois de release()', async () => {
    await service.begin('key-1', { amountInCents: 100 });
    await service.release('key-1');

    const result = await service.begin('key-1', { amountInCents: 100 });

    expect(result.replayed).toBe(false);
  });

  it('não mistura chaves diferentes', async () => {
    await service.begin('key-1', { amountInCents: 100 });

    const result = await service.begin('key-2', { amountInCents: 100 });

    expect(result.replayed).toBe(false);
  });

  it('explode alto se complete() for chamado sem begin()', async () => {
    await expect(service.complete('sem-begin', {}, 201)).rejects.toThrow(
      /bug/,
    );
  });
});
