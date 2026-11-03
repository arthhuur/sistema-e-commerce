/**
 * Um ponto onde o nosso registro e o extrato do gateway NÃO batem.
 *
 * Cada `kind` é um tipo diferente de problema, e cada um pede uma ação
 * diferente do time financeiro. Separar por tipo é o que transforma um
 * "os números não fecham" em "temos 3 cobranças fantasma para investigar".
 */
export type DivergenceKind =
  /** Temos o pagamento aqui, mas o gateway não o liquidou. */
  | 'missing_in_settlement'
  /** O gateway liquidou algo que não existe no nosso registro. */
  | 'missing_internally'
  /** O valor cobrado é diferente do que registramos. */
  | 'amount_mismatch'
  /** A taxa cobrada é diferente do combinado. */
  | 'fee_mismatch'
  /** O gateway diz uma coisa (ex.: recusado), nós registramos outra. */
  | 'status_mismatch';

export interface Divergence {
  kind: DivergenceKind;
  /** A referência que liga os dois lados (id do pagamento). */
  reference: string;
  /** Explicação legível, com os números, para o time financeiro agir. */
  detail: string;
}
