/**
 * Uma linha do EXTRATO do gateway.
 *
 * O gateway é a "fonte da verdade" do dinheiro: quando ele liquida, ele manda
 * esse relatório dizendo, para cada transação, quanto cobrou e quanto sobrou.
 *
 * `externalReference` é a ponte entre os dois mundos: quando disparamos a
 * cobrança, mandamos a NOSSA referência (o id do pagamento) e o gateway a
 * devolve no extrato. É por ela que conseguimos casar as duas listas.
 */
export type SettlementStatus = 'approved' | 'declined';

export interface SettlementLine {
  /** Nossa referência, ecoada pelo gateway. */
  externalReference: string;
  /** Valor cobrado do cliente, em centavos. */
  amountInCents: number;
  /** Taxa que o gateway diz ter cobrado, em centavos. */
  totalFeeInCents: number;
  /** O que o gateway diz ter repassado ao lojista, em centavos. */
  netAmountInCents: number;
  status: SettlementStatus;
}
