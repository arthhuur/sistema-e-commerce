import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { App } from 'supertest/types.js';
import { createTestApp } from './test-app.js';
import { authenticatedAgent } from './authenticate.js';
import { Payment } from '../src/payments/payment.entity.js';

/**
 * Testes E2E do resumo do dashboard (`GET /dashboard/summary`).
 *
 * Duas armadilhas estão cobertas aqui, e nenhuma delas apareceria num teste
 * "feliz" mal feito:
 *
 * 1. TIPOS. `COUNT` e `SUM` no Postgres voltam como TEXTO pelo driver `pg`.
 *    Se ninguém converter, o JSON sai `"60000"` em vez de `60000` — e uma soma
 *    de "60000" + "10000" (concatenção) daria "6000010000" no front, com a
 *    tela bonita e o número absurdo. Os `typeof ... toBe('number')` abaixo
 *    existem para pegar exatamente isso.
 * 2. PERFIL. O resumo entrega faturamento e taxas. O guard de perfil é quem
 *    protege, não a tela: por isso o teste confere que vendedor recebe 403.
 */

/** Linha pronta para gravar; `createdAt` quem preenche é o banco. */
type SeedRow = Omit<Payment, 'createdAt'>;

function makePayment(
  index: number,
  amountInCents: number,
  totalFeeInCents: number,
): SeedRow {
  return {
    id: `dash-${index}`,
    amountInCents,
    currency: 'BRL',
    productId: 'dash-produto',
    gatewayId: 'dash-gateway',
    gatewayName: 'gateway-de-teste',
    netAmountInCents: amountInCents - totalFeeInCents,
    totalFeeInCents,
    status: 'approved',
  };
}

/** Data `yyyy-mm-dd` no fuso LOCAL (o servidor monta as datas assim também). */
function localDateOnly(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * As três vendas de hoje, com valores redondos de propósito:
 *   total 60000 | taxas 2448 | líquido 57552 | ticket médio 20000
 */
const VENDAS: Array<[number, number]> = [
  [10000, 448],
  [20000, 800],
  [30000, 1200],
];

describe('Resumo do dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
  let payments: Repository<Payment>;

  beforeEach(async () => {
    app = await createTestApp();
    agent = await authenticatedAgent(app, 'gerente');
    payments = app.get<Repository<Payment>>(getRepositoryToken(Payment));

    await payments.insert(
      VENDAS.map(([amount, fee], index) => makePayment(index + 1, amount, fee)),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('resume o dia com números reais (e como números, não texto)', async () => {
    const response = await agent.get('/dashboard/summary').expect(200);

    expect(response.body.paymentCount).toBe(3);
    expect(response.body.totalProcessedInCents).toBe(60000);
    expect(response.body.averageTicketInCents).toBe(20000);
    expect(response.body.netReceivedInCents).toBe(57552);
    expect(response.body.totalFeesInCents).toBe(2448);

    // A rede de proteção contra o driver devolver `bigint`/`numeric` como texto.
    expect(typeof response.body.totalProcessedInCents).toBe('number');
    expect(typeof response.body.paymentCount).toBe('number');
    expect(typeof response.body.averageTicketInCents).toBe('number');

    // O período volta junto: sem ele o front não sabe dizer "de quando" é o número.
    expect(typeof response.body.periodStart).toBe('string');
    expect(typeof response.body.periodEnd).toBe('string');
  });

  it('num período sem vendas devolve zeros — nunca NaN', async () => {
    const response = await agent
      .get(`/dashboard/summary?from=${localDateOnly(1)}`)
      .expect(200);

    // `averageTicketInCents` é divisão: com zero vendas, dividir por zero daria
    // NaN, que no JSON viraria `null` e quebraria a tela. Vira 0.
    expect(response.body).toMatchObject({
      paymentCount: 0,
      totalProcessedInCents: 0,
      averageTicketInCents: 0,
      netReceivedInCents: 0,
      totalFeesInCents: 0,
    });
  });

  it('filtra pelo período informado', async () => {
    const hoje = localDateOnly(0);

    const hojeMesmo = await agent
      .get(`/dashboard/summary?from=${hoje}&to=${hoje}`)
      .expect(200);
    expect(hojeMesmo.body.paymentCount).toBe(3);

    const ontem = await agent
      .get(`/dashboard/summary?to=${localDateOnly(-1)}`)
      .expect(200);
    expect(ontem.body.paymentCount).toBe(0);
  });

  it('nega os números a quem não é gerente nem financeiro (403)', async () => {
    // O ponto central: estar logado NÃO basta quando a rota expõe o
    // faturamento. Quem barra é o `RolesGuard`, no backend.
    const vendedor = await authenticatedAgent(app, 'vendedor');
    await vendedor.get('/dashboard/summary').expect(403);

    const estoque = await authenticatedAgent(app, 'estoque');
    await estoque.get('/dashboard/summary').expect(403);
  });

  it('permite ao perfil financeiro', async () => {
    const financeiro = await authenticatedAgent(app, 'financeiro');
    await financeiro.get('/dashboard/summary').expect(200);
  });

  it('exige sessão (401 sem login)', async () => {
    await request(app.getHttpServer()).get('/dashboard/summary').expect(401);
  });

  it('recusa período fora do padrão ISO (400)', async () => {
    await agent.get('/dashboard/summary?from=ontem').expect(400);
    await agent.get('/dashboard/summary?to=05/11/2026').expect(400);
  });
});
