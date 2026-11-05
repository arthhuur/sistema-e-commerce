/**
 * Avaliação de UM gateway candidato para uma transação específica.
 *
 * Guardamos o custo E a chance de aprovação juntos, porque decidir só pelo
 * custo é um erro: o gateway mais barato pode recusar mais transações e, no
 * fim do mês, render menos.
 */
export interface GatewayEvaluation {
  gatewayId: string;
  gatewayName: string;
  /** Taxa total do gateway, em centavos. */
  totalFeeInCents: number;
  /** Líquido se a transação for APROVADA, em centavos. */
  netAmountInCents: number;
  /** Probabilidade de aprovação, de 0 a 1. */
  approvalRate: number;
  /**
   * Líquido ESPERADO, em centavos: o net ponderado pela chance de aprovação.
   *
   * Por que não comparar só o custo? Exemplo real:
   *   Gateway A: líquido 9552c, aprovação 92%  -> esperado 8788c
   *   Gateway B: líquido 9700c, aprovação 70%  -> esperado 6790c
   * B cobra menos (líquido maior), mas A rende mais na média. Essa é a métrica
   * que decide — e é o que diferencia este projeto de um CRUD.
   */
  expectedNetInCents: number;
}

/**
 * O resultado da decisão de roteamento.
 *
 * Devolvemos TODOS os candidatos ordenados, não só o vencedor. Motivo: uma
 * decisão de dinheiro precisa ser auditável. Se o lojista perguntar "por que
 * essa transação foi pelo gateway X?", a resposta está aqui.
 */
export interface RoutingDecision {
  amountInCents: number;
  chosen: GatewayEvaluation | null;
  /** Explicação em texto de por que esse gateway venceu. */
  reason: string;
  /** Ranking do melhor para o pior. */
  candidates: GatewayEvaluation[];
}
