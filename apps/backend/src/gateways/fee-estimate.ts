/**
 * Resultado de uma estimativa de taxa.
 *
 * Tudo em CENTAVOS e em número inteiro. Isso é uma decisão consciente:
 * dinheiro em ponto flutuante acumula erro (0.1 + 0.2 !== 0.3 em JS).
 * O padrão do mercado é trafegar e calcular em centavos, e só formatar
 * para exibição na ponta (ex.: R$ 12,34).
 */
export interface FeeEstimate {
  gatewayId: string;
  gatewayName: string;
  /** Valor da transação, em centavos. */
  amountInCents: number;
  /** Parte fixa da taxa, em centavos. */
  feeFixedInCents: number;
  /** Parte percentual da taxa, já arredondada, em centavos. */
  feePercentInCents: number;
  /** Taxa total cobrada pelo gateway, em centavos. */
  totalFeeInCents: number;
  /** O que sobra para o lojista, em centavos. */
  netAmountInCents: number;
}
