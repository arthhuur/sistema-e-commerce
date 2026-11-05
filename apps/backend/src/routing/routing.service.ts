import { Injectable } from '@nestjs/common';
import { GatewaysService } from '../gateways/gateways.service.js';
import { RoutingDecision, GatewayEvaluation } from './routing-decision.js';

/**
 * O MOTOR DE ROTEAMENTO — o cérebro do projeto.
 *
 * Repare na linha do construtor: este Service depende de OUTRO Service.
 * Como o GatewaysService pertence a outro módulo (GatewaysModule), o módulo
 * de origem precisa EXPORTÁ-LO e este módulo precisa IMPORTAR aquele.
 * É assim que o Nest resolve dependências entre partes do sistema — e por isso
 * "exports" no module não é enfeite, é obrigatório.
 *
 * `decide` virou `async` na Fase 2 porque agora as duas coisas que ele faz
 * (listar gateways e calcular taxas) são consultas ao banco.
 */
@Injectable()
export class RoutingService {
  constructor(private readonly gatewaysService: GatewaysService) {}

  async decide(amountInCents: number): Promise<RoutingDecision> {
    // 1. Só gateways ATIVOS podem receber transação.
    const activeGateways = await this.gatewaysService.findAll({ active: true });

    // 2. Sem candidatos, não inventamos decisão: devolvemos "nada escolhido"
    //    com o motivo. Um sistema de pagamento precisa falhar de forma clara.
    if (activeGateways.length === 0) {
      return {
        amountInCents,
        chosen: null,
        reason: 'Nenhum gateway ativo disponível para rotear.',
        candidates: [],
      };
    }

    // 3. Avaliamos cada candidato: custo individual + chance de aprovação.
    //
    //    `Promise.all` em vez de um `for` com `await` dentro: as consultas são
    //    INDEPENDENTES entre si, então não há motivo para esperar uma terminar
    //    antes de começar a próxima. Disparando todas juntas, o tempo total é
    //    o da mais lenta — e não a SOMA de todas.
    const candidates: GatewayEvaluation[] = await Promise.all(
      activeGateways.map(async (gateway) => {
        const estimate = await this.gatewaysService.estimateFee(
          gateway.id,
          amountInCents,
        );

        return {
          gatewayId: estimate.gatewayId,
          gatewayName: estimate.gatewayName,
          totalFeeInCents: estimate.totalFeeInCents,
          netAmountInCents: estimate.netAmountInCents,
          approvalRate: gateway.approvalRate,
          expectedNetInCents: Math.round(
            estimate.netAmountInCents * gateway.approvalRate,
          ),
        };
      }),
    );

    // 4. Ordenamos do melhor para o pior pelo líquido ESPERADO.
    //    `[...candidates]` cria uma cópia porque sort() mexe no array original;
    //    mutar a lista de entrada daria efeito colateral escondido.
    //    Desempate: o sort é estável, então empate mantém a ordem de cadastro.
    const ranked = [...candidates].sort(
      (a, b) => b.expectedNetInCents - a.expectedNetInCents,
    );

    const chosen = ranked[0];
    const runnerUp = ranked[1];

    const reason = runnerUp
      ? `${chosen.gatewayName} escolhido: líquido esperado de ${chosen.expectedNetInCents}c, contra ${runnerUp.expectedNetInCents}c de ${runnerUp.gatewayName}.`
      : `${chosen.gatewayName} escolhido: é o único gateway ativo.`;

    return { amountInCents, chosen, reason, candidates: ranked };
  }
}
