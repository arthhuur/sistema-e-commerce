import { Payment } from '../payments/payment.entity.js';
import { SettlementLine } from './settlement-line.js';
import { Divergence, DivergenceKind } from './divergence.js';
import { ReconciliationReport } from './reconciliation-report.js';

/**
 * A conciliação processada EM FLUXO (streaming), linha a linha.
 *
 * A diferença crucial para a versão que recebe um array é como o dado entra:
 *
 *   Array:      você já tem 100 mil linhas na memória antes de começar.
 *   Streaming:  você recebe 1 linha, compara, joga fora. Repete 100 mil vezes.
 *
 * A memória usada aqui NÃO cresce com o tamanho do extrato. Um extrato de
 * 1 milhão de linhas custa o mesmo que um de 1 mil linhas, porque só o
 * `divergences` (que em operação normal é minúsculo) e o índice do nosso lado
 * ocupam espaço. É isso que permite escalar.
 *
 * Repare que o índice do nosso lado (`internalById`) É carregado inteiro. Não
 * tem como evitar: para comparar, precisamos saber o que nós registramos. A
 * diferença é que esse lado é limitado pelo nosso volume de vendas, não pelo
 * tamanho do arquivo que o gateway manda.
 */
export class ReconciliationSession {
  private readonly internalById: Map<string, Payment>;
  private readonly internalNetInCents: number;

  /**
   * Referências do nosso lado que apareceram no extrato.
   *
   * Guardamos o PAGAMENTO (o objeto), e não o texto da referência. Parece
   * detalhe, mas não é: a referência que chega em `line.externalReference` foi
   * criada pelo `JSON.parse` da linha do extrato. Se guardássemos o texto, ele
   * ficaria PRESO na memória até o fim da execução — e num extrato de milhões
   * de linhas isso vira centenas de MB de strings idênticas às que já existem
   * dentro do `internalById`.
   *
   * Guardando o objeto, o Set carrega só uma seta apontando para algo que já
   * estava vivo. A string do extrato morre assim que a linha é descartada.
   */
  private readonly seenReferences = new Set<Payment>();

  private readonly divergences: Divergence[] = [];

  private settlementNetInCents = 0;
  private lineCount = 0;

  constructor(internalPayments: Payment[]) {
    this.internalById = new Map(
      internalPayments.map((payment) => [payment.id, payment]),
    );
    this.internalNetInCents = internalPayments.reduce(
      (sum, payment) => sum + payment.netAmountInCents,
      0,
    );
  }

  /** Quantas linhas do extrato já passaram por aqui. */
  get processedLines(): number {
    return this.lineCount;
  }

  /**
   * Processa UMA linha do extrato. É este método que roda 100 mil vezes, então
   * ele precisa ser barato: três comparações e dois acessos a Map.
   */
  addLine(line: SettlementLine): void {
    this.lineCount += 1;
    this.settlementNetInCents += line.netAmountInCents;

    const payment = this.internalById.get(line.externalReference);

    if (!payment) {
      this.push(
        'missing_internally',
        line.externalReference,
        `O extrato traz ${line.amountInCents}c (líquido ${line.netAmountInCents}c) que não existe no nosso registro.`,
      );
      return;
    }

    this.seenReferences.add(payment);

    if (line.amountInCents !== payment.amountInCents) {
      this.push(
        'amount_mismatch',
        payment.id,
        `Valor divergente: nosso ${payment.amountInCents}c x extrato ${line.amountInCents}c.`,
      );
    }

    if (line.totalFeeInCents !== payment.totalFeeInCents) {
      this.push(
        'fee_mismatch',
        payment.id,
        `Taxa divergente: nossa ${payment.totalFeeInCents}c x extrato ${line.totalFeeInCents}c.`,
      );
    }

    if (line.status !== payment.status) {
      this.push(
        'status_mismatch',
        payment.id,
        `Status divergente: nosso "${payment.status}" x extrato "${line.status}".`,
      );
    }
  }

  /** Processa um lote. Útil quando o dado já está em memória. */
  addLines(lines: Iterable<SettlementLine>): void {
    for (const line of lines) {
      this.addLine(line);
    }
  }

  /** Fecha a conta e devolve o relatório. */
  finish(): ReconciliationReport {
    // Só no FIM dá para saber quem NÃO apareceu no extrato — e é justamente o
    // motivo de o streaming funcionar: nunca precisamos guardar o extrato,
    // apenas marcar quem já vimos.
    const missingInSettlement: Divergence[] = [];
    for (const payment of this.internalById.values()) {
      if (!this.seenReferences.has(payment)) {
        missingInSettlement.push({
          kind: 'missing_in_settlement',
          reference: payment.id,
          detail: `Registramos ${payment.amountInCents}c (líquido ${payment.netAmountInCents}c) mas o gateway não liquidou esta transação.`,
        });
      }
    }

    // Mantemos a agrupação do relatório original: os "não liquidados" primeiro
    // (é a informação mais urgente para o financeiro), depois os divergentes.
    const divergences = [...missingInSettlement, ...this.divergences];

    const referenceWithProblem = new Set(
      divergences.map((divergence) => divergence.reference),
    );
    let matched = 0;
    for (const payment of this.internalById.values()) {
      if (!referenceWithProblem.has(payment.id)) {
        matched += 1;
      }
    }

    return {
      checkedAt: new Date(),
      matched,
      divergences,
      totals: {
        internalNetInCents: this.internalNetInCents,
        settlementNetInCents: this.settlementNetInCents,
        differenceInCents: this.settlementNetInCents - this.internalNetInCents,
      },
    };
  }

  private push(
    kind: DivergenceKind,
    reference: string,
    detail: string,
  ): void {
    this.divergences.push({ kind, reference, detail });
  }
}
