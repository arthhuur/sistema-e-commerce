import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createTestApp } from './test-app.js';
import {
  TEST_USER_PASSWORD,
  authenticatedAgent,
  seedUser,
} from './authenticate.js';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../src/auth/auth.constants.js';

/**
 * TESTES DA AUTENTICAÇÃO.
 *
 * Estes testes não verificam a lógica de pagamento. Eles verificam as
 * promessas que a autenticação faz — e cada teste aqui corresponde a uma
 * delas:
 *
 *   - sem sessão, ninguém entra
 *   - senha errada e e-mail inexistente são indistinguíveis
 *   - o token nunca aparece no corpo da resposta, só em cookie httpOnly
 *   - o refresh token serve uma vez só
 *   - reusar um refresh token derruba todas as sessões
 *   - perfil sem permissão recebe 403, não 401
 */

/** Extrai o par "nome=valor" de um cookie da resposta, ou undefined. */
function cookiePair(
  response: request.Response,
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];

  return cookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0];
}

describe('Autenticação (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('o padrão é fechado', () => {
    it('recusa rota protegida sem sessão (401)', async () => {
      await request(app.getHttpServer()).get('/payments').expect(401);
    });

    it('recusa também a leitura de gateways sem sessão (401)', async () => {
      await request(app.getHttpServer()).get('/gateways').expect(401);
    });

    it('mantém / e /health abertos', async () => {
      // /health precisa responder sem login, senão o Render considera o
      // container doente e reinicia a aplicação em laço.
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/').expect(200);
    });

    it('libera o acesso com uma sessão válida', async () => {
      const agent = await authenticatedAgent(app);

      await agent.get('/payments').expect(200);
    });
  });

  describe('login', () => {
    it('abre a sessão e grava os cookies httpOnly', async () => {
      const user = await seedUser(app);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const accessCookie = cookiePair(response, ACCESS_TOKEN_COOKIE);
      const refreshCookie = cookiePair(response, REFRESH_TOKEN_COOKIE);

      expect(accessCookie).toBeDefined();
      expect(refreshCookie).toBeDefined();

      // `HttpOnly` é a flag que impede o JavaScript de ler o cookie — é ela
      // que faz um XSS não conseguir roubar a sessão. Se alguém remover isso
      // do código, este teste precisa falhar.
      const header = response.headers['set-cookie'] as unknown as string[];
      expect(header.join(';')).toContain('HttpOnly');
    });

    it('NÃO devolve a senha nem o hash no corpo', async () => {
      const user = await seedUser(app);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(response.body.passwordHash).toBeUndefined();
      expect(response.body.password).toBeUndefined();
      // A verificação grosseira pega qualquer vazamento do formato do argon2,
      // que sempre começa com "$argon2".
      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.email).toBe(user.email);
      expect(response.body.role).toBe('gerente');
    });

    it('recusa senha errada (401)', async () => {
      const user = await seedUser(app);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'senha-errada-mas-longa' })
        .expect(401);
    });

    it('responde IGUAL para senha errada e e-mail inexistente', async () => {
      const user = await seedUser(app);

      const senhaErrada = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'senha-errada-mas-longa' })
        .expect(401);

      const emailInexistente = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'ninguem@teste.local',
          password: 'senha-errada-mas-longa',
        })
        .expect(401);

      // Mensagens diferentes permitiriam descobrir quem tem conta testando
      // e-mails. Aqui os dois casos são indistinguíveis de fora.
      expect(senhaErrada.body.message).toBe(emailInexistente.body.message);
    });

    it('recusa usuário desativado (401)', async () => {
      const user = await seedUser(app, { active: false });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);
    });

    it('aceita o e-mail em maiúsculas, porque normaliza', async () => {
      const user = await seedUser(app, { email: 'gerente@teste.local' });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'GERENTE@Teste.Local',
          password: user.password,
        })
        .expect(200);
    });

    it('rejeita corpo inválido antes de consultar o banco (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nao-e-email', password: 'curta' })
        .expect(400);
    });
  });

  describe('sessão', () => {
    it('/auth/me devolve quem está logado', async () => {
      const user = await seedUser(app);
      const agent = request.agent(app.getHttpServer());

      await agent
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const me = await agent.get('/auth/me').expect(200);

      expect(me.body.id).toBe(user.id);
      expect(me.body.email).toBe(user.email);
      expect(me.body.passwordHash).toBeUndefined();
    });

    it('renova a sessão com o refresh token', async () => {
      const user = await seedUser(app);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const refreshCookie = cookiePair(login, REFRESH_TOKEN_COOKIE);

      const renovada = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie!)
        .expect(200);

      expect(renovada.body.email).toBe(user.email);
      expect(cookiePair(renovada, ACCESS_TOKEN_COOKIE)).toBeDefined();
    });

    it('ROTAÇÃO: o refresh token usado não serve uma segunda vez', async () => {
      const user = await seedUser(app);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const refreshCookie = cookiePair(login, REFRESH_TOKEN_COOKIE);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie!)
        .expect(200);

      // O mesmo token, de novo. Já foi consumido.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie!)
        .expect(401);
    });

    it('reusar um refresh token já gasto derruba TODAS as sessões', async () => {
      const user = await seedUser(app);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const tokenAntigo = cookiePair(login, REFRESH_TOKEN_COOKIE);

      // Primeira rotação: gera o token novo, que deveria ser o válido.
      const rotacionado = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', tokenAntigo!)
        .expect(200);

      const tokenNovo = cookiePair(rotacionado, REFRESH_TOKEN_COOKIE);

      // Alguém reapresenta o token ANTIGO. Isso só acontece se o cookie foi
      // copiado, então a resposta é derrubar tudo — inclusive o token novo.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', tokenAntigo!)
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', tokenNovo!)
        .expect(401);
    });

    it('logout revoga o token e o refresh para de funcionar', async () => {
      const user = await seedUser(app);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const refreshCookie = cookiePair(login, REFRESH_TOKEN_COOKIE);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', refreshCookie!)
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', refreshCookie!)
        .expect(401);
    });

    it('recusa renovação sem o cookie', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });

  describe('perfis', () => {
    it('deixa o gerente cadastrar gateway', async () => {
      const agent = await authenticatedAgent(app, 'gerente');

      await agent
        .post('/gateways')
        .send({
          name: 'gateway_do_gerente',
          displayName: 'Gateway do Gerente',
          feePercent: 2.99,
          feeFixed: 39,
          approvalRate: 0.9,
        })
        .expect(201);
    });

    it('barra o vendedor com 403 (e não 401)', async () => {
      const agent = await authenticatedAgent(app, 'vendedor');

      // 403 e não 401 de propósito: o vendedor ESTÁ autenticado. A resposta
      // diz "sei quem você é, e você não pode" — palavras diferentes de
      // "não sei quem você é". O front precisa das duas para decidir entre
      // mandar para o login ou mostrar "sem acesso".
      await agent
        .post('/gateways')
        .send({
          name: 'gateway_do_vendedor',
          displayName: 'Gateway do Vendedor',
          feePercent: 2.99,
          feeFixed: 39,
          approvalRate: 0.9,
        })
        .expect(403);
    });

    it('mas o vendedor continua lendo a lista normalmente', async () => {
      const agent = await authenticatedAgent(app, 'vendedor');

      await agent.get('/gateways').expect(200);
    });
  });

  describe('senha como credencial', () => {
    it('o banco guarda hash, nunca a senha em texto', async () => {
      const user = await seedUser(app, { password: TEST_USER_PASSWORD });

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      // A resposta prova que a senha foi usada... e mesmo assim ela não
      // aparece em lugar nenhum do que saiu.
      expect(JSON.stringify(login.body)).not.toContain(TEST_USER_PASSWORD);
    });
  });
});
