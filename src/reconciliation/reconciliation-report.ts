import { Divergence } from './divergence.js';

/**
 * O resultado de uma conciliação.
 *
 * Isto é o "relatório" que o financeiro lê. Ele responde duas perguntas:
 *  1. O que não bateu?  -> `divergences`
 *  2. Quanto estamos perdendo? -> `totals.differenceInCents`
 *
 * A segunda pergunta é a que o dono da empresa realmente faz.
 */
export interface ReconciliationReport {
  checkedAt: Date;
  /** Quantos pagamentos internos bateram 100% com o extrato. */
  matched: number;
  divergences: Divergence[];
  totals: {
    /** Soma do líquido segundo NÓS. */
    internalNetInCents: number;
    /** Soma do líquido segundo o GATEWAY. */
    settlementNetInCents: number;
    /** gateway - nosso. Positivo = o gateway repassou mais do que anotamos. */
    differenceInCents: number;
  };
}
