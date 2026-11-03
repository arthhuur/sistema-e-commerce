import { Test, TestingModule } from '@nestjs/testing';
import { RoutingService } from './routing.service.js';
import { GatewaysService } from '../gateways/gateways.service.js';

/**
 * Testes UNITÁRIOS do motor de roteamento.
 *
 * Aqui está o maior benefício da INJEÇÃO DE DEPENDÊNCIA que expliquei no início:
 * trocamos o GatewaysService por um "dublê" (mock). Assim testamos SÓ a lógica
 * de decisão, sem depender do cálculo real nem do Map em memória.
 *
 * Se a decisão fosse escrita dentro do Controller, com `new GatewaysService()`,
 * este teste seria impossível sem subir a aplicação inteira.
 */
describe('RoutingService', () => {
  let service: RoutingService;

  const gatewaysServiceMock = {
    findAll: vi.fn(),
    estimateFee: vi.fn(),
  };

  beforeEach(async () => {
    // Limpa histórico e implementações entre testes, para um teste não
    // "vazar" comportamento para o próximo.
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutingService,
        { provide: GatewaysService, useValue: gatewaysServiceMock },
      ],
    }).compile();

    service = module.get<RoutingService>(RoutingService);
  });

  /** Configura dois gateways com trade-off clássico: caro/bom x barato/ruim. */
  function mockTwoGateways(): void {
    // Mapa id -> nome para o mock devolver o MESMO nome que findAll() entrega.
    // O Service usa estimate.gatewayName no texto do motivo, então o dublê
    // precisa ser coerente com a lista; caso contrário o teste falha por dado
    // de teste inconsistente, e não por bug de produção.
    const namesById: Record<string, string> = {
      a: 'caro_que_aprova',
      b: 'barato_que_recusa',
    };

    // `mockResolvedValue`, e não `mockReturnValue`: na Fase 2 os dois métodos
    // do GatewaysService falam com o banco e devolvem Promise. Devolver o valor
    // cru faria o `await` lá dentro receber um objeto comum — que funcionaria
    // por acaso em alguns pontos e quebraria em outros.
    gatewaysServiceMock.findAll.mockResolvedValue([
      { id: 'a', name: namesById.a, approvalRate: 0.92 },
      { id: 'b', name: namesById.b, approvalRate: 0.7 },
    ]);

    gatewaysServiceMock.estimateFee.mockImplementation(
      async (id: string, amountInCents: number) => {
        // "b" tem líquido MAIOR (cobra menos), mas aprova menos.
        const netAmountInCents = id === 'a' ? 9552 : 9700;

        return {
          gatewayId: id,
          gatewayName: namesById[id],
          amountInCents,
          feeFixedInCents: 0,
          feePercentInCents: 0,
          totalFeeInCents: amountInCents - netAmountInCents,
          netAmountInCents,
        };
      },
    );
  }

  it('escolhe o maior líquido ESPERADO, e não o de menor taxa', async () => {
    mockTwoGateways();

    const decision = await service.decide(10000);

    // A: 9552 * 0.92 = 8787.84 -> 8788
    // B: 9700 * 0.70 = 6790
    expect(decision.chosen?.gatewayId).toBe('a');
    expect(decision.chosen?.expectedNetInCents).toBe(8788);
  });

  it('devolve o ranking do melhor para o pior', async () => {
    mockTwoGateways();

    const decision = await service.decide(10000);

    expect(decision.candidates.map((candidate) => candidate.gatewayId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('explica em texto por que o gateway venceu', async () => {
    mockTwoGateways();

    const decision = await service.decide(10000);

    expect(decision.reason).toContain('caro_que_aprova');
    expect(decision.reason).toContain('8788');
  });

  it('considera somente gateways ativos', async () => {
    mockTwoGateways();

    await service.decide(10000);

    // Verifica a INTENÇÃO, não só o resultado: se alguém trocar findAll() por
    // uma busca sem filtro, este teste avisa.
    expect(gatewaysServiceMock.findAll).toHaveBeenCalledWith({ active: true });
  });

  it('não escolhe nada quando não há gateway ativo, e diz o motivo', async () => {
    gatewaysServiceMock.findAll.mockResolvedValue([]);

    const decision = await service.decide(10000);

    expect(decision.chosen).toBeNull();
    expect(decision.candidates).toEqual([]);
    expect(decision.reason).toContain('Nenhum gateway ativo');
  });

  it('não muta o array original ao ordenar', async () => {
    const original = [
      { id: 'a', name: 'a', approvalRate: 0.5 },
      { id: 'b', name: 'b', approvalRate: 0.9 },
    ];
    gatewaysServiceMock.findAll.mockResolvedValue(original);
    gatewaysServiceMock.estimateFee.mockImplementation(
      async (id: string, amountInCents: number) => ({
        gatewayId: id,
        gatewayName: id,
        amountInCents,
        feeFixedInCents: 0,
        feePercentInCents: 0,
        totalFeeInCents: 0,
        netAmountInCents: 10000,
      }),
    );

    await service.decide(10000);

    // sort() mexe no array onde é chamado; por isso o Service copia antes.
    expect(original.map((gateway) => gateway.id)).toEqual(['a', 'b']);
  });
});
