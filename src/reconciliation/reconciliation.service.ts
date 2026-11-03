import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service.js';
import { SettlementLine } from './settlement-line.js';
import { ReconciliationReport } from './reconciliation-report.js';
import { ReconciliationSession } from './reconciliation-session.js';

/**
 * O CONCILIADOR — compara dois lados e aponta o que não bate.
 *
 * Lado A (interno): o que o nosso sistema registrou. Vem do PaymentsService.
 * Lado B (extrato):  o que o gateway diz ter acontecido.
 *
 * Repare que o Service NÃO contém mais a regra da conciliação. Ele só escolhe
 * COMO o extrato entra (uma lista que já está na memória, ou um fluxo que
 * chega aos poucos) e delega o trabalho para a `ReconciliationSession`.
 *
 * Isso é de propósito: se a regra ficasse escrita aqui E na sessão, as duas
 * cópias iam divergir na primeira correção. Regra de negócio mora num lugar
 * só; o Service é a porta de entrada dela.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Caminho CLÁSSICO: o extrato inteiro já está em memória (array).
   * Bom para lotes pequenos e para os testes unitários, que montam a lista
   * na mão.
   *
   * Virou `async` na Fase 2: o "nosso lado" agora é uma consulta ao banco, e
   * precisamos ESPERAR a lista chegar antes de comparar. Repare que só a
   * BUSCA é assíncrona — a comparação em si continua igual.
   */
  async reconcile(lines: SettlementLine[]): Promise<ReconciliationReport> {
    const session = new ReconciliationSession(
      await this.paymentsService.findAll(),
    );
    session.addLines(lines);
    return session.finish();
  }

  /**
   * Caminho de ESCALA: o extrato chega como fluxo (streaming).
   *
   * `for await` consome uma linha por vez e a descarta logo depois de
   * comparar. A memória usada aqui NÃO depende do tamanho do extrato — por
   * isso um arquivo de 100 mil linhas custa o mesmo que um de mil.
   *
   * A regra é EXATAMENTE a mesma do `reconcile` acima: ambos empurram linhas
   * para uma `ReconciliationSession`. Só muda a forma de alimentar.
   */
  async reconcileStream(
    lines: AsyncIterable<SettlementLine>,
  ): Promise<ReconciliationReport> {
    const session = new ReconciliationSession(
      await this.paymentsService.findAll(),
    );
    for await (const line of lines) {
      session.addLine(line);
    }
    return session.finish();
  }
}
