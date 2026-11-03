import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createTestApp } from './test-app.js';

/**
 * Testes E2E do fluxo de pagamento — tudo passa por HTTP de verdade.
 *
 * Diferença para os testes de Service (`*.service.spec.ts`): aqui não existe
 * dublê nenhum. É a aplicação inteira, com Controller + ValidationPipe +
 * roteamento de URL + serialização. Se alguém esquecer um `@Type()` num DTO ou
 * trocar a ordem das rotas, é AQUI que o erro aparece — nos testes de Service
 * ele passaria batido.
 *
 * Cada teste sobe uma app nova. Na Fase 1 isso bastava: os `Map` em memória
 * nasciam vazios. Com o dado no Postgres, `createTestApp()` ainda apaga as
 * tabelas do banco de teste ao subir — é isso que garante que um teste nunca
 * enxergue o lixo do outro.
 */
describe('Fluxo de pagamento (e2e)', () => {
  let app: INestApplication<App>;

  /** Gateway caro que aprova muito. */
  const caroQueAprova = {
    name: 'caro_que_aprova',
    displayName: 'Caro que Aprova',
    feePercent: 3.99,
    feeFixed: 49,
    approvalRate: 0.92,
  };

  /** Gateway barato que recusa muito. */
  const baratoQueRecusa = {
    name: 'barato_que_recusa',
    displayName: 'Barato que Recusa',
    feePercent: 2.5,
    feeFixed: 30,
    approvalRate: 0.7,
  };

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('ciclo completo: cadastro -> roteamento -> cobrança -> replay -> conciliação', async () => {
    const server = app.getHttpServer();

    // 1) Cadastramos os dois gateways pela própria API.
    await request(server).post('/gateways').send(caroQueAprova).expect(201);
    await request(server).post('/gateways').send(baratoQueRecusa).expect(201);

    // 2) Cobrança de R$ 100,00 (10.000 centavos), com a etiqueta de idempotência.
    const primeira = await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'pedido-e2e-1')
      .send({ amountInCents: 10000, productId: 'prod-e2e-1' })
      .expect(201);

    // O roteador deve escolher o que rende mais na média:
    //   caro:   9552 * 0.92 = 8788c esperados
    //   barato: 9720 * 0.70 = 6804c esperados
    expect(primeira.body.gatewayName).toBe('caro_que_aprova');
    expect(primeira.body.totalFeeInCents).toBe(448);
    expect(primeira.body.netAmountInCents).toBe(9552);
    expect(primeira.headers['idempotent-replay']).toBeUndefined();

    // 3) O cliente reenvia a MESMA cobrança (timeout, duplo clique, retry...).
    const replay = await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'pedido-e2e-1')
      .send({ amountInCents: 10000, productId: 'prod-e2e-1' })
      .expect(201);

    // Mesmo id = mesmo pagamento. E o cabeçalho avisa que foi replay.
    expect(replay.body.id).toBe(primeira.body.id);
    expect(replay.headers['idempotent-replay']).toBe('true');

    // 4) O livro caixa tem UM registro só: ninguém foi cobrado duas vezes.
    const livroCaixa = await request(server).get('/payments').expect(200);
    expect(livroCaixa.body).toHaveLength(1);

    // 5) Conciliação: extrato com a nossa transação + uma cobrança fantasma.
    const relatorio = await request(server)
      .post('/reconciliation/run')
      .send({
        lines: [
          {
            externalReference: primeira.body.id,
            amountInCents: 10000,
            totalFeeInCents: 448,
            netAmountInCents: 9552,
            status: 'approved',
          },
          {
            externalReference: 'cobranca-fantasma',
            amountInCents: 5000,
            totalFeeInCents: 100,
            netAmountInCents: 4900,
            status: 'approved',
          },
        ],
      })
      .expect(200);

    expect(relatorio.body.matched).toBe(1);
    expect(relatorio.body.divergences).toHaveLength(1);
    expect(relatorio.body.divergences[0].kind).toBe('missing_internally');
    // Nosso líquido 9552 x extrato 14452 -> sobra 4900c inexplicados.
    expect(relatorio.body.totals.differenceInCents).toBe(4900);
  });

  it('recusa cobrança sem o cabeçalho Idempotency-Key (400)', async () => {
    const server = app.getHttpServer();
    await request(server).post('/gateways').send(caroQueAprova).expect(201);

    await request(server)
      .post('/payments')
      .send({ amountInCents: 10000, productId: 'prod-1' })
      .expect(400);
  });

  it('recusa corpo inválido e campo desconhecido (400)', async () => {
    const server = app.getHttpServer();
    await request(server).post('/gateways').send(caroQueAprova).expect(201);

    // amountInCents precisa ser inteiro >= 1.
    await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'invalido-1')
      .send({ amountInCents: 0, productId: 'prod-1' })
      .expect(400);

    // forbidNonWhitelisted: campo que não existe no DTO é REJEITADO, não
    // apenas ignorado. Repare que "hacker" não causa efeito nenhum — só erro.
    await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'invalido-2')
      .send({ amountInCents: 10000, productId: 'prod-1', hacker: true })
      .expect(400);
  });

  it('recusa a mesma chave com corpo diferente (422)', async () => {
    const server = app.getHttpServer();
    await request(server).post('/gateways').send(caroQueAprova).expect(201);

    await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'pedido-e2e-2')
      .send({ amountInCents: 10000, productId: 'prod-1' })
      .expect(201);

    await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'pedido-e2e-2')
      .send({ amountInCents: 20000, productId: 'prod-1' })
      .expect(422);
  });

  it('devolve 503 quando não existe gateway ativo', async () => {
    // Nenhum gateway cadastrado nesta app.
    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', 'sem-gateway')
      .send({ amountInCents: 10000, productId: 'prod-1' })
      .expect(503);
  });

  it('recusa o pagamento quando o fornecedor não tem estoque (422)', async () => {
    const server = app.getHttpServer();
    await request(server).post('/gateways').send(caroQueAprova).expect(201);

    // Na simulação do SuppliersService, IDs com "out-of-stock" falham.
    await request(server)
      .post('/payments')
      .set('Idempotency-Key', 'sem-estoque-e2e')
      .send({ amountInCents: 10000, productId: 'item-out-of-stock-123' })
      .expect(422)
      .then((res) => {
        expect(res.body.message).toContain('sem estoque disponível');
      });
  });

  it('valida CADA linha do extrato — prova que @Type + @ValidateNested atuam', async () => {
    // Este teste é uma rede de segurança contra a armadilha silenciosa do
    // class-validator: se alguém remover o `@Type(() => SettlementLineDto)`,
    // a validação da linha simplesmente para de existir — e sem este teste
    // ninguém descobriria, porque a API continuaria respondendo 200.
    await request(app.getHttpServer())
      .post('/reconciliation/run')
      .send({
        lines: [
          {
            externalReference: 'qualquer',
            amountInCents: 10000,
            totalFeeInCents: 448,
            netAmountInCents: 9552,
            status: 'status-que-nao-existe',
          },
        ],
      })
      .expect(400);
  });
});
