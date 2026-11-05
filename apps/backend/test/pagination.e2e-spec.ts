import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { App } from 'supertest/types.js';
import { createTestApp } from './test-app.js';
import { authenticatedAgent } from './authenticate.js';
// Import de VALOR (sem `type`): `Payment` é usado em `getRepositoryToken()`,
// que roda em tempo de execução.
import { Payment } from '../src/payments/payment.entity.js';

/**
 * Testes E2E da listagem paginada (`GET /payments`).
 *
 * O QUE ESTE ARQUIVO PROTEGE.
 *
 * Paginação parece detalhe, mas erra de dois jeitos silenciosos:
 *
 * 1. Devolver a lista inteira "sem querer" (o gargalo volta e ninguém percebe
 *    enquanto o banco for pequeno).
 * 2. Ordenar por uma coluna que EMPATA (aqui, `createdAt`) sem critério de
 *    desempate: com várias linhas no mesmo instante, a mesma linha pode
 *    aparecer em duas páginas — ou sumir de todas. É o bug clássico de
 *    paginação, e o teste "não repete nem some" é quem o pega.
 *
 * Por isso o dado é semeado em UM único INSERT: todas as 25 linhas nascem com
 * o MESMO `createdAt`, que é exatamente o cenário que expõe o empate.
 */

/** Linha pronta para gravar; `createdAt` quem preenche é o banco. */
type SeedRow = Omit<Payment, 'createdAt'>;

/**
 * Id determinístico e ORDENÁVEL: `pag-0001`..`pag-0025`.
 *
 * É isso que permite conferir a ordem da resposta sem ler o banco de volta —
 * o teste sabe qual id deveria vir primeiro.
 */
function makePayment(index: number): SeedRow {
  return {
    id: `pag-${String(index).padStart(4, '0')}`,
    amountInCents: 10000,
    currency: 'BRL',
    productId: 'pag-produto',
    gatewayId: 'pag-gateway',
    gatewayName: 'gateway-de-teste',
    netAmountInCents: 9552,
    totalFeeInCents: 448,
    status: 'approved',
  };
}

/**
 * Data no formato `yyyy-mm-dd`, no fuso LOCAL.
 *
 * Não dá para usar `toISOString().slice(0, 10)`: em São Paulo (UTC-3), às 22h
 * o horário UTC já é o dia seguinte, e o teste pediria "amanhã" achando que
 * pediu "hoje". O servidor monta as datas pelo fuso local (veja
 * `parseDateRange`), então o teste precisa fazer igual.
 */
function localDateOnly(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

const SEEDED = 25;

describe('Paginação e filtros do livro caixa (e2e)', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
  let payments: Repository<Payment>;

  beforeEach(async () => {
    app = await createTestApp();
    agent = await authenticatedAgent(app, 'gerente');
    payments = app.get<Repository<Payment>>(getRepositoryToken(Payment));

    const rows = Array.from({ length: SEEDED }, (_, index) =>
      makePayment(index + 1),
    );
    // INSERT único: um só comando, um só instante, 25 `createdAt` idênticos.
    await payments.insert(rows);
  });

  afterEach(async () => {
    await app.close();
  });

  it('devolve a página com o TOTAL real, não o tamanho da página', async () => {
    const response = await agent.get('/payments').expect(200);

    // O número que desenha a navegação é `total`. `data.length` é só a página.
    expect(response.body.total).toBe(SEEDED);
    expect(response.body.data).toHaveLength(20);
    expect(response.body.page).toBe(1);
    expect(response.body.limit).toBe(20);
  });

  it('a segunda página traz o que sobrou', async () => {
    const response = await agent.get('/payments?page=2').expect(200);

    expect(response.body.total).toBe(SEEDED);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.page).toBe(2);
  });

  it('respeita o `limit` pedido', async () => {
    const response = await agent.get('/payments?limit=10&page=3').expect(200);

    expect(response.body.limit).toBe(10);
    expect(response.body.page).toBe(3);
    expect(response.body.data).toHaveLength(5);
  });

  it('não repete nem some linha ao trocar de página', async () => {
    // O teste que pega o empate de ordenação. Se o desempate por `id` sumisse,
    // o Postgres poderia devolver as mesmas linhas em duas páginas (ou pular
    // algumas) — e a soma dos pedaços deixaria de dar o total.
    const pages = await Promise.all([
      agent.get('/payments?limit=10&page=1').expect(200),
      agent.get('/payments?limit=10&page=2').expect(200),
      agent.get('/payments?limit=10&page=3').expect(200),
    ]);

    const ids = pages.flatMap((response) =>
      (response.body.data as Payment[]).map((payment) => payment.id),
    );

    expect(ids).toHaveLength(SEEDED);
    // Sem repetidos...
    expect(new Set(ids).size).toBe(SEEDED);
    // ...e do mais novo para o mais velho (id maior primeiro).
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('página além do fim devolve vazio, mas ainda conta o total', async () => {
    const response = await agent.get('/payments?page=99').expect(200);

    expect(response.body.data).toEqual([]);
    expect(response.body.total).toBe(SEEDED);
  });

  it('filtra por status', async () => {
    const response = await agent.get('/payments?status=approved').expect(200);

    expect(response.body.total).toBe(SEEDED);
  });

  it('recusa status que não existe (400)', async () => {
    // Lista vazia seria a resposta "silenciosa" para um status inventado; o
    // 400 diz na hora que o valor não é válido.
    await agent.get('/payments?status=recusado').expect(400);
  });

  it('filtra por período incluindo o dia INTEIRO das duas pontas', async () => {
    const today = localDateOnly(0);

    const dentroDoDia = await agent
      .get(`/payments?from=${today}&to=${today}`)
      .expect(200);

    // Este é o caso que quebra se `to` for interpretado como meia-noite: as
    // vendas do próprio dia sumiriam.
    expect(dentroDoDia.body.total).toBe(SEEDED);

    const amanha = await agent
      .get(`/payments?from=${localDateOnly(1)}`)
      .expect(200);
    expect(amanha.body.total).toBe(0);

    const ontem = await agent
      .get(`/payments?to=${localDateOnly(-1)}`)
      .expect(200);
    expect(ontem.body.total).toBe(0);
  });

  it('recusa paginação e filtros inválidos (400)', async () => {
    // Não numérico.
    await agent.get('/payments?page=abc').expect(400);
    // Zero não é página.
    await agent.get('/payments?page=0').expect(400);
    // Acima do teto: um `limit` gigante traria o banco inteiro de volta.
    await agent.get('/payments?limit=1000').expect(400);
    // Data fora do padrão ISO.
    await agent.get('/payments?from=05/11/2026').expect(400);
    // Campo que não existe no DTO é REJEITADO (forbidNonWhitelisted).
    await agent.get('/payments?whatever=1').expect(400);
  });

  it('exige sessão (401 sem login)', async () => {
    // A paginação mudou o formato da resposta, não a proteção da rota.
    await request(app.getHttpServer()).get('/payments').expect(401);
  });
});
