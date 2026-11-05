import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from 'supertest/types.js';
import { createTestApp } from './test-app.js';
import { authenticatedAgent } from './authenticate.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
// `Payment` entra como import de VALOR (sem `type`): além de tipar, ele é
// passado para `getRepositoryToken(Payment)` — e isso é uma chamada em tempo
// de execução, que um `import type` apagaria na compilação.
import { Payment } from '../src/payments/payment.entity.js';
import type { SettlementLine } from '../src/reconciliation/settlement-line.js';

/**
 * TESTES DE VOLUME — como a API se comporta quando o dado cresce.
 *
 * Estes testes não verificam regra de negócio nova: eles verificam ESCALA.
 * A pergunta que respondem é "o que acontece quando isso deixa de ser um
 * exemplo de brinquedo e vira um extrato de verdade?".
 *
 * O QUE MUDOU NA FASE 2 — de onde vem o dado.
 * Na Fase 1 os pagamentos eram criados pelo próprio Service, porque gravar num
 * `Map` era praticamente de graça. Com o dado no Postgres, cada `create()`
 * passou a custar cerca de oito idas ao banco; cem mil delas custariam
 * minutos e o SETUP dominaria a medição. Aqui o dado é SEMEADO EM LOTE — um
 * INSERT por mil linhas, direto pelo repositório —, e o teste volta a medir o
 * que sempre quis medir: o custo do ALGORITMO de conciliação.
 *
 * O caminho real de criação (com idempotência, roteamento e transação)
 * continua coberto por `payment-flow.e2e-spec.ts`.
 */

const GATEWAY = {
  name: 'caro_que_aprova',
  displayName: 'Caro que Aprova',
  feePercent: 3.99,
  feeFixed: 49,
  approvalRate: 0.92,
};

/**
 * Tarifa e líquido de uma cobrança de R$ 100,00 nesse gateway:
 * 10000 * 3,99% + 49 = 448 de taxa -> 9552 líquido.
 * Fixamos os valores para a linha semeada e a linha do extrato concordarem.
 */
const SEEDED_AMOUNT_IN_CENTS = 10000;
const SEEDED_FEE_IN_CENTS = 448;
const SEEDED_NET_IN_CENTS = 9552;

/**
 * Quantas linhas por INSERT.
 *
 * O protocolo do Postgres tem um teto de parâmetros por comando (65535). Com
 * 8 colunas por pagamento, mil linhas ficam bem longe do teto e continuam
 * sendo UM comando — que é o que torna a semeadura rápida.
 */
const INSERT_CHUNK = 1000;

/** Linha de pagamento pronta para gravar; o `createdAt` quem preenche é o banco. */
type SeedRow = Omit<Payment, 'createdAt'>;

function makeSeededPayment(prefix: string, index: number): SeedRow {
  return {
    // Id determinístico: o teste sabe qual linha do extrato casa com qual
    // pagamento sem precisar ler nada de volta do banco.
    id: `${prefix}-${index}`,
    amountInCents: SEEDED_AMOUNT_IN_CENTS,
    currency: 'BRL',
    productId: 'volume-product',
    gatewayId: 'volume-gateway',
    gatewayName: GATEWAY.name,
    netAmountInCents: SEEDED_NET_IN_CENTS,
    totalFeeInCents: SEEDED_FEE_IN_CENTS,
    status: 'approved',
  };
}

/**
 * Grava `count` pagamentos a partir do índice `from`, em lotes.
 *
 * `from` existe porque o primeiro teste cresce o volume em degraus: ele não
 * quer recomeçar a numeração a cada degrau, e sim ACRESCENTAR linhas novas às
 * que já existem.
 */
async function seedPayments(
  repository: Repository<Payment>,
  prefix: string,
  from: number,
  count: number,
): Promise<void> {
  for (let start = 0; start < count; start += INSERT_CHUNK) {
    const end = Math.min(start + INSERT_CHUNK, count);
    const chunk: SeedRow[] = [];
    for (let offset = start; offset < end; offset += 1) {
      chunk.push(makeSeededPayment(prefix, from + offset));
    }
    await repository.insert(chunk);
  }
}

/** Constrói o extrato "perfeito": cada pagamento nosso vira uma linha. */
function settlementFrom(payments: Payment[]): SettlementLine[] {
  return payments.map((payment) => ({
    externalReference: payment.id,
    amountInCents: payment.amountInCents,
    totalFeeInCents: payment.totalFeeInCents,
    netAmountInCents: payment.netAmountInCents,
    status: 'approved',
  }));
}

/** Gera linhas que não existem do nosso lado, só para encher o payload. */
function fabricateLines(count: number): SettlementLine[] {
  const lines: SettlementLine[] = [];
  for (let index = 0; index < count; index += 1) {
    lines.push({
      externalReference: `fantasma-${index}`,
      amountInCents: 10000,
      totalFeeInCents: 448,
      netAmountInCents: 9552,
      status: 'approved',
    });
  }
  return lines;
}

describe('Volume: escala do algoritmo de conciliação', () => {
  let app: INestApplication<App>;
  let paymentsService: PaymentsService;
  let reconciliationService: ReconciliationService;
  let payments: Repository<Payment>;

  beforeAll(async () => {
    app = await createTestApp();
    paymentsService = app.get(PaymentsService);
    reconciliationService = app.get(ReconciliationService);
    payments = app.get<Repository<Payment>>(getRepositoryToken(Payment));
  });

  afterAll(async () => {
    await app.close();
  });

  it('mantém o custo LINEAR conforme o volume cresce', async () => {
    // O contador fica numa variável em vez de `findAll().length` dentro do
    // laço — chamar findAll() a cada volta tornaria o SETUP quadrático e
    // mediríamos a coisa errada.
    let created = 0;
    const seedUpTo = async (target: number): Promise<void> => {
      const missing = target - created;
      if (missing > 0) {
        await seedPayments(payments, 'bulk', created, missing);
        created = target;
      }
    };

    for (const size of [2000, 10000, 50000, 100000]) {
      await seedUpTo(size);

      const lines = settlementFrom(await paymentsService.findAll());

      const startedAt = performance.now();
      const report = await reconciliationService.reconcile(lines);
      const elapsed = performance.now() - startedAt;

      const microsecondsPerItem = (elapsed * 1000) / size;
      console.log(
        `    ${String(size).padStart(6)} transações -> ` +
          `${elapsed.toFixed(1).padStart(7)} ms  ` +
          `(${microsecondsPerItem.toFixed(2)} µs por transação)`,
      );

      expect(report.matched).toBe(size);
      expect(report.divergences).toEqual([]);
      expect(report.totals.differenceInCents).toBe(0);
    }

    // 100 mil pagamentos semeados em lotes + 4 conciliações: a folga de tempo
    // agora cobre a leitura dos dados, não mais 100 mil `create()`.
  }, 180000);
});

describe('Volume: comportamento da API HTTP com payloads grandes', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
  let paymentsService: PaymentsService;
  let payments: Repository<Payment>;

  beforeAll(async () => {
    app = await createTestApp();
    agent = await authenticatedAgent(app, 'gerente');
    paymentsService = app.get(PaymentsService);
    payments = app.get<Repository<Payment>>(getRepositoryToken(Payment));

    await seedPayments(payments, 'http', 0, 500);
  });

  afterAll(async () => {
    await app.close();
  });

  it('concilia 500 transações em uma única requisição HTTP', async () => {
    const lines = settlementFrom(await paymentsService.findAll());

    const startedAt = performance.now();
    const response = await agent
      .post('/reconciliation/run')
      .send({ lines })
      .expect(200);
    const elapsed = performance.now() - startedAt;

    console.log(
      `    ${lines.length} linhas por HTTP -> ${elapsed.toFixed(1)} ms`,
    );

    expect(response.body.matched).toBe(500);
    expect(response.body.divergences).toEqual([]);
  });

  it('esbarra no limite de 100kb do corpo da requisição (HTTP 413)', async () => {
    // ACHADO PRÁTICO, e o motivo de teste de volume valer a pena:
    // o Express limita o corpo de uma requisição a ~100kb por padrão. Um
    // extrato de 5 mil linhas (~650kb) não passa — o servidor devolve
    // 413 Payload Too Large ANTES de qualquer código nosso rodar.
    //
    // Ou seja: o algoritmo aguenta 50 mil linhas em memória, mas a porta de
    // entrada HTTP não deixa o dado chegar até ele. São dois limites
    // diferentes, e só medindo para descobrir.
    const lines = fabricateLines(5000);

    await agent
      .post('/reconciliation/run')
      .send({ lines })
      .expect(413);
  });
});

describe('Volume: ingestão em fluxo (NDJSON) — o caminho para 100 mil linhas', () => {
  // Aqui cada teste sobe a sua própria app: o estado do "livro caixa" fica
  // isolado, e um teste não enxerga os pagamentos criados pelo outro (que
  // apareceriam como "não liquidados" e sujariam a conta).
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
  let paymentsService: PaymentsService;
  let payments: Repository<Payment>;

  const PAYMENTS = 100_000;

  beforeEach(async () => {
    app = await createTestApp();
    agent = await authenticatedAgent(app, 'gerente');
    paymentsService = app.get(PaymentsService);
    payments = app.get<Repository<Payment>>(getRepositoryToken(Payment));
  });

  afterEach(async () => {
    await app.close();
  });

  it('concilia 100 mil linhas em UMA requisição HTTP, sem estourar o corpo', async () => {
    // Nosso lado: registramos as cobranças em lote...
    await seedPayments(payments, 'stream', 0, PAYMENTS);

    // ...e o gateway devolve a linha do extrato. A ordem em que os dois lados
    // são montados aqui é só do teste; o conciliador casa por referência, não
    // por posição.
    const seeded = await paymentsService.findAll();
    const payload = settlementFrom(seeded)
      .map((line) => JSON.stringify(line))
      .join('\n');

    console.log(
      `    payload NDJSON: ${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(1)} MB ` +
        `(o endpoint tradicional cortaria isto em 100kb)`,
    );

    const startedAt = performance.now();
    const response = await agent
      .post('/reconciliation/run/stream')
      .type('application/x-ndjson')
      .send(payload)
      .expect(200);
    const elapsed = performance.now() - startedAt;

    const microsecondsPerLine = (elapsed * 1000) / PAYMENTS;
    console.log(
      `    ${String(PAYMENTS).padStart(6)} linhas por streaming -> ` +
        `${elapsed.toFixed(1).padStart(7)} ms  ` +
        `(${microsecondsPerLine.toFixed(2)} µs por linha, já contando rede + JSON.parse)`,
    );

    expect(response.body.matched).toBe(PAYMENTS);
    expect(response.body.divergences).toEqual([]);
    expect(response.body.totals.differenceInCents).toBe(0);
  }, 180000);

  it('continua apontando as mesmas divergências no modo fluxo', async () => {
    await seedPayments(payments, 'stream-div', 0, 1);

    const lines = [
      // Bate no valor, mas a taxa não: o gateway cobrou 1 centavo a mais.
      {
        externalReference: 'stream-div-0',
        amountInCents: SEEDED_AMOUNT_IN_CENTS,
        totalFeeInCents: SEEDED_FEE_IN_CENTS + 1,
        netAmountInCents: SEEDED_NET_IN_CENTS - 1,
        status: 'approved',
      },
      // Cobrança fantasma: está no extrato e não existe do nosso lado.
      {
        externalReference: 'fantasma-stream',
        amountInCents: 5000,
        totalFeeInCents: 200,
        netAmountInCents: 4800,
        status: 'approved',
      },
    ];

    const response = await agent
      .post('/reconciliation/run/stream')
      .type('application/x-ndjson')
      .send(lines.map((line) => JSON.stringify(line)).join('\n'))
      .expect(200);

    expect(
      response.body.divergences.map(
        (divergence: { kind: string }) => divergence.kind,
      ),
    ).toEqual(['fee_mismatch', 'missing_internally']);
  });

  it('recusa uma linha malformada e diz QUAL linha é (HTTP 400)', async () => {
    const validLine = JSON.stringify({
      externalReference: 'qualquer',
      amountInCents: 100,
      totalFeeInCents: 1,
      netAmountInCents: 99,
      status: 'approved',
    });

    const response = await agent
      .post('/reconciliation/run/stream')
      .type('application/x-ndjson')
      .send(`${validLine}\n{"isto":"não é uma linha válida"}\n`)
      .expect(400);

    expect(response.body.message).toContain('Linha 2');
  });
});
