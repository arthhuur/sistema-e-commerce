import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { Payment } from './payment.entity.js';
import { IdempotencyRecord } from './idempotency-record.js';
import { SuppliersService } from './suppliers.service.js';
import { RoutingService } from '../routing/routing.service.js';
import { RoutingDecision } from '../routing/routing-decision.js';
import { testDatabaseOptions, truncateAll } from '../../test/test-database.js';

/**
 * Testes do PaymentsService.
 *
 * Estratégia: usamos um dublê do RoutingService (não queremos testar o
 * roteamento aqui) mas o IdempotencyService DE VERDADE, porque a interação
 * entre os dois (reservar, concluir, liberar) é justamente o que queremos
 * provar que funciona.
 *
 * O QUE MUDOU NA FASE 2 — o livro caixa ficou de verdade.
 * Na Fase 1 o `Map` vivia só no processo, então o teste era 100% síncrono.
 * Agora o pagamento e a etiqueta de idempotência moram no Postgres, e o
 * Service inteiro virou assíncrono. Isso traz uma consequência boa: o teste
 * de "não cobra duas vezes" e o de "grava atomicamente" passam a exercitar o
 * BANCO de verdade — inclusive a transação que junta as duas gravações.
 *
 * O dublê do roteador também mudou de forma: `decide` agora devolve Promise,
 * então usamos `mockResolvedValue` em vez de `mockReturnValue`.
 */
describe('PaymentsService', () => {
  let service: PaymentsService;
  let idempotencyService: IdempotencyService;
  let module: TestingModule;
  let dataSource: DataSource;

  const routingServiceMock = { decide: vi.fn() };
  const suppliersServiceMock = { checkStock: vi.fn() };

  /** Uma decisão de roteamento pronta, para não repetir em cada teste. */
  const decision: RoutingDecision = {
    amountInCents: 10000,
    chosen: {
      gatewayId: 'a',
      gatewayName: 'caro_que_aprova',
      totalFeeInCents: 448,
      netAmountInCents: 9552,
      approvalRate: 0.92,
      expectedNetInCents: 8788,
    },
    reason: 'caro_que_aprova escolhido: é o melhor líquido esperado.',
    candidates: [],
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(testDatabaseOptions()),
        TypeOrmModule.forFeature([Payment, IdempotencyRecord]),
      ],
      providers: [
        PaymentsService,
        // IdempotencyService REAL: queremos testar a interação, não simular.
        IdempotencyService,
        { provide: RoutingService, useValue: routingServiceMock },
        { provide: SuppliersService, useValue: suppliersServiceMock },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    idempotencyService = module.get<IdempotencyService>(IdempotencyService);
    dataSource = module.get<DataSource>(DataSource);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    routingServiceMock.decide.mockResolvedValue(decision);
    suppliersServiceMock.checkStock.mockResolvedValue(true);
    // Livro caixa e caderno de etiquetas limpos: o isolamento que o `Map` dava
    // de graça agora precisa ser pedido explicitamente ao banco.
    await truncateAll(dataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  it('cria o pagamento na primeira chamada', async () => {
    const result = await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    expect(result.replayed).toBe(false);
    expect(result.statusCode).toBe(201);
    expect(result.payment.gatewayName).toBe('caro_que_aprova');
    expect(result.payment.netAmountInCents).toBe(9552);
    expect(result.payment.id).toBeTruthy();
  });

  it('NÃO cobra duas vezes com a mesma chave e o mesmo corpo', async () => {
    const first = await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });
    const second = await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    // Mesmo id -> é literalmente o mesmo pagamento, não um novo.
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.replayed).toBe(true);
    expect(second.statusCode).toBe(201);
    // A prova mais importante: o motor de roteamento rodou só UMA vez.
    expect(routingServiceMock.decide).toHaveBeenCalledTimes(1);
  });

  it('recusa a mesma chave com corpo diferente (HTTP 422)', async () => {
    await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    await expect(
      service.create('key-1', { amountInCents: 20000, productId: 'prod-1' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('recusa a requisição sem cabeçalho Idempotency-Key (HTTP 400)', async () => {
    await expect(
      service.create(undefined, { amountInCents: 10000, productId: 'prod-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('trata moeda omitida e "BRL" explícito como o MESMO pedido', async () => {
    // Prova que normalizamos a moeda ANTES de gerar a impressão digital.
    const first = await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });
    const second = await service.create('key-1', {
      amountInCents: 10000,
      productId: 'prod-1',
      currency: 'BRL',
    });

    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
  });

  it('devolve 503 quando não há gateway, e libera a chave para retentar', async () => {
    routingServiceMock.decide.mockResolvedValueOnce({
      ...decision,
      chosen: null,
      candidates: [],
      reason: 'Nenhum gateway ativo disponível para rotear.',
    });

    await expect(
      service.create('key-1', { amountInCents: 10000, productId: 'prod-1' }),
    ).rejects.toThrow(ServiceUnavailableException);

    // A chave foi LIBERADA na falha, então a mesma chave ainda pode ser usada.
    routingServiceMock.decide.mockResolvedValue(decision);
    const retry = await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    expect(retry.replayed).toBe(false);
    expect(retry.payment.gatewayName).toBe('caro_que_aprova');
  });

  it('barra requisição concorrente com a mesma chave (HTTP 409)', async () => {
    // Simula "outra requisição já reservou esta chave e ainda está rodando".
    await idempotencyService.begin('key-1', {
      amountInCents: 10000,
      currency: 'BRL',
    });

    await expect(
      service.create('key-1', { amountInCents: 10000, productId: 'prod-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('guarda o pagamento no livro caixa', async () => {
    await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    const ledger = await service.findAll();

    expect(ledger).toHaveLength(1);
    expect(ledger[0].gatewayName).toBe('caro_que_aprova');
  });

  it('não duplica no livro caixa quando a chamada é replay', async () => {
    await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });
    await service.create('key-1', { amountInCents: 10000, productId: 'prod-1' });

    expect(await service.findAll()).toHaveLength(1);
  });

  it('não guarda nada no livro caixa quando a cobrança falha', async () => {
    routingServiceMock.decide.mockResolvedValueOnce({
      ...decision,
      chosen: null,
      candidates: [],
      reason: 'Nenhum gateway ativo disponível para rotear.',
    });

    await expect(
      service.create('key-1', { amountInCents: 10000, productId: 'prod-1' }),
    ).rejects.toThrow();

    expect(await service.findAll()).toHaveLength(0);
  });

  it('recusa o pagamento quando o fornecedor não tem estoque (HTTP 422)', async () => {
    suppliersServiceMock.checkStock.mockResolvedValueOnce(false);

    await expect(
      service.create('key-1', { amountInCents: 10000, productId: 'sem-estoque' }),
    ).rejects.toThrow(UnprocessableEntityException);

    // Garante que nem tentou rotear se não tem estoque
    expect(routingServiceMock.decide).not.toHaveBeenCalled();
    // Garante que a chave foi liberada
    const retry = await service.create('key-1', { amountInCents: 10000, productId: 'com-estoque' });
    expect(retry.replayed).toBe(false);
  });
});
