import { Test, TestingModule } from '@nestjs/testing';
import { ReconciliationService } from './reconciliation.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { Payment } from '../payments/payment.entity.js';
import { SettlementLine } from './settlement-line.js';

/**
 * Testes do conciliador.
 *
 * Dublamos o PaymentsService (só precisamos que ele devolva uma lista) e
 * alimentamos o outro lado na mão. Assim conseguimos forçar cada tipo de
 * divergência de propósito — o que seria impossível esperando acontecer
 * naturalmente.
 *
 * Padrão "factory com overrides": montamos um objeto válido por padrão e cada
 * teste troca SÓ o campo que importa. Evita spread em instância de classe (que
 * o linter reprova) e deixa claro o que cada teste está mudando.
 */
describe('ReconciliationService', () => {
  let service: ReconciliationService;

  const paymentsServiceMock = { findAll: vi.fn() };

  function makePayment(overrides: Partial<Payment> = {}): Payment {
    return {
      id: overrides.id ?? 'pay-1',
      amountInCents: overrides.amountInCents ?? 10000,
      currency: overrides.currency ?? 'BRL',
      gatewayId: overrides.gatewayId ?? 'gateway-1',
      gatewayName: overrides.gatewayName ?? 'caro_que_aprova',
      netAmountInCents: overrides.netAmountInCents ?? 9552,
      totalFeeInCents: overrides.totalFeeInCents ?? 448,
      status: overrides.status ?? 'approved',
      createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    };
  }

  function makeLine(overrides: Partial<SettlementLine> = {}): SettlementLine {
    return {
      externalReference: overrides.externalReference ?? 'pay-1',
      amountInCents: overrides.amountInCents ?? 10000,
      totalFeeInCents: overrides.totalFeeInCents ?? 448,
      netAmountInCents: overrides.netAmountInCents ?? 9552,
      status: overrides.status ?? 'approved',
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: PaymentsService, useValue: paymentsServiceMock },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
  });

  it('não aponta nada quando os dois lados batem', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([makeLine()]);

    expect(report.divergences).toEqual([]);
    expect(report.matched).toBe(1);
    expect(report.totals.differenceInCents).toBe(0);
  });

  it('aponta pagamento nosso que o gateway não liquidou', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment({ id: 'pay-1' })]);

    const report = await service.reconcile([]);

    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0].kind).toBe('missing_in_settlement');
    expect(report.divergences[0].reference).toBe('pay-1');
    expect(report.matched).toBe(0);
  });

  it('aponta transação do extrato que não temos (cobrança fantasma)', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([]);

    const report = await service.reconcile([
      makeLine({ externalReference: 'desconhecido-9' }),
    ]);

    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0].kind).toBe('missing_internally');
    expect(report.divergences[0].reference).toBe('desconhecido-9');
  });

  it('aponta divergência de valor', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([makeLine({ amountInCents: 15000 })]);

    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0].kind).toBe('amount_mismatch');
  });

  it('aponta divergência de taxa', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([makeLine({ totalFeeInCents: 500 })]);

    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0].kind).toBe('fee_mismatch');
  });

  it('aponta divergência de status', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([makeLine({ status: 'declined' })]);

    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0].kind).toBe('status_mismatch');
  });

  it('acumula várias divergências de uma transação só', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([
      makeLine({
        amountInCents: 15000,
        totalFeeInCents: 500,
        status: 'declined',
      }),
    ]);

    expect(report.divergences.map((divergence) => divergence.kind)).toEqual([
      'amount_mismatch',
      'fee_mismatch',
      'status_mismatch',
    ]);
  });

  it('calcula a diferença de líquido entre os dois lados', async () => {
    // Nosso lado: 9552. Extrato: 9552 (pay-1) + 10000 de uma cobrança fantasma.
    paymentsServiceMock.findAll.mockResolvedValue([makePayment()]);

    const report = await service.reconcile([
      makeLine(),
      makeLine({
        externalReference: 'fantasma-1',
        amountInCents: 10448,
        totalFeeInCents: 448,
        netAmountInCents: 10000,
      }),
    ]);

    expect(report.totals.internalNetInCents).toBe(9552);
    expect(report.totals.settlementNetInCents).toBe(19552);
    expect(report.totals.differenceInCents).toBe(10000);
    // O pagamento interno em si bateu; a fantasma é que gerou a diferença.
    expect(report.matched).toBe(1);
  });

  it('conta como matched só o que passou limpo', async () => {
    paymentsServiceMock.findAll.mockResolvedValue([
      makePayment({ id: 'ok' }),
      makePayment({ id: 'com-problema' }),
    ]);

    const report = await service.reconcile([
      makeLine({ externalReference: 'ok' }),
      makeLine({ externalReference: 'com-problema', amountInCents: 999 }),
    ]);

    expect(report.matched).toBe(1);
    expect(report.divergences).toHaveLength(1);
  });
});
