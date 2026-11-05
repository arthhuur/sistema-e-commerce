import { INestApplication } from '@nestjs/common';
import { OTP } from 'otplib';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { createTestApp } from './test-app.js';
import { authenticatedAgent, login, seedUser } from './authenticate.js';
import {
  ACCESS_TOKEN_COOKIE,
  MFA_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../src/auth/auth.constants.js';
import { User } from '../src/auth/user.entity.js';
import { RecoveryCode } from '../src/auth/recovery-code.entity.js';

/**
 * TESTES DO SEGUNDO FATOR (TOTP).
 *
 * Cada teste aqui corresponde a uma promessa do 2FA, e não a um detalhe de
 * implementação:
 *
 *   - o 2FA só passa a valer depois de a pessoa PROVAR que o aplicativo
 *     autenticador está sincronizado;
 *   - o login, com o 2FA ativo, NÃO abre sessão antes do código;
 *   - um desvio pequeno de relógio não tranca ninguém para fora;
 *   - um desvio grande, sim — senão a "tolerância" viraria um 2FA de fachada;
 *   - os códigos de recuperação servem uma única vez;
 *   - o segredo fica CIFRADO e os códigos como HASH no banco;
 *   - o token do meio do login não vale como sessão (e vice-versa).
 */

const totp = new OTP({ strategy: 'totp' });

/** Gera o código que o aplicativo autenticador mostraria `secondsAgo` atrás. */
function codeFrom(secret: string, secondsAgo = 0): string {
  return totp.generateSync({
    secret,
    epoch: Math.floor(Date.now() / 1000) - secondsAgo,
  });
}

/** Extrai o segredo escondido na URL `otpauth://` devolvida pelo setup. */
function secretFromOtpauth(url: string): string {
  const secret = new URL(url).searchParams.get('secret');

  if (!secret) {
    throw new Error(`A URL otpauth não trouxe um segredo: ${url}`);
  }

  return secret;
}

/** Extrai o par "nome=valor" de um cookie da resposta, ou undefined. */
function cookiePair(
  response: request.Response,
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];

  return cookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0];
}

type Agent = ReturnType<typeof request.agent>;

/** Percorre setup + ativação por uma sessão já autenticada. */
async function enrollMfa(
  agent: Agent,
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await agent.post('/auth/mfa/setup').expect(200);
  const secret = secretFromOtpauth(setup.body.otpauthUrl);

  const activated = await agent
    .post('/auth/mfa/activate')
    .send({ code: codeFrom(secret) })
    .expect(200);

  return { secret, recoveryCodes: activated.body.recoveryCodes as string[] };
}

/**
 * Cria um usuário COM o 2FA já ligado.
 *
 * Passa pelo fluxo real (login → setup → activate) em vez de escrever o
 * segredo à mão no banco: assim o teste também exercita a configuração, e um
 * segredo gravado de forma errada não passaria despercebido.
 */
async function userWithMfa(app: INestApplication<App>): Promise<{
  user: Awaited<ReturnType<typeof seedUser>>;
  secret: string;
  recoveryCodes: string[];
}> {
  const user = await seedUser(app);
  const agent = await login(app, user.email, user.password);
  const { secret, recoveryCodes } = await enrollMfa(agent);

  return { user, secret, recoveryCodes };
}

/** Abre uma sessão completa vencendo as duas etapas do login. */
async function mfaSession(
  app: INestApplication<App>,
  user: { email: string; password: string },
  secret: string,
): Promise<Agent> {
  const agent = request.agent(app.getHttpServer());

  await agent
    .post('/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);
  await agent
    .post('/auth/mfa/verify')
    .send({ code: codeFrom(secret) })
    .expect(200);

  return agent;
}

describe('Segundo fator (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('configuração', () => {
    it('começa desligado', async () => {
      const agent = await authenticatedAgent(app);

      const status = await agent.get('/auth/mfa').expect(200);

      expect(status.body).toEqual({ enabled: false, pending: false });
    });

    it('o setup devolve a URL otpauth e o QR, e deixa a configuração pendente', async () => {
      const agent = await authenticatedAgent(app);

      const setup = await agent.post('/auth/mfa/setup').expect(200);

      const otpauth = new URL(setup.body.otpauthUrl);
      expect(otpauth.protocol).toBe('otpauth:');
      expect(otpauth.searchParams.get('issuer')).toBe('Payment Router');
      expect(otpauth.searchParams.get('secret')).toBeTruthy();

      // O QR precisa ser uma imagem pronta para um <img src>, não um caminho.
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

      const status = await agent.get('/auth/mfa').expect(200);
      expect(status.body).toEqual({ enabled: false, pending: true });
    });

    it('só passa a valer DEPOIS de confirmar um código', async () => {
      const user = await seedUser(app);
      const agent = await login(app, user.email, user.password);

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      // Antes de confirmar, o login ainda é só senha.
      const antes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      expect(antes.body.mfaRequired).toBeUndefined();
      expect(antes.body.email).toBe(user.email);

      await agent
        .post('/auth/mfa/activate')
        .send({ code: codeFrom(secret) })
        .expect(200);

      // Depois de confirmar, o login passa a exigir o código.
      const depois = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      expect(depois.body.mfaRequired).toBe(true);
    });

    it('devolve 10 códigos de recuperação distintos, sem caracteres ambíguos', async () => {
      const user = await seedUser(app);
      const agent = await login(app, user.email, user.password);

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      const activated = await agent
        .post('/auth/mfa/activate')
        .send({ code: codeFrom(secret) })
        .expect(200);

      const codes = activated.body.recoveryCodes as string[];
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);

      for (const code of codes) {
        expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
        // O alfabeto exclui I, O, 0 e 1 — os que se confundem ao digitar.
        expect(code).not.toMatch(/[IO01]/);
      }
    });

    it('guarda o segredo CIFRADO e os códigos como HASH', async () => {
      const { user, secret, recoveryCodes } = await userWithMfa(app);

      const stored = await app
        .get(DataSource)
        .getRepository(User)
        .findOne({
          where: { id: user.id },
          select: { id: true, totpSecret: true, totpEnabledAt: true },
        });

      // O que saiu no QR é o segredo; o que está no banco é outra coisa.
      expect(stored?.totpSecret).toBeDefined();
      expect(stored?.totpSecret).not.toBe(secret);
      expect(stored?.totpSecret).toMatch(/^v1\./);
      expect(stored?.totpEnabledAt).toBeInstanceOf(Date);

      const rows = await app
        .get(DataSource)
        .getRepository(RecoveryCode)
        .find({ where: { userId: user.id } });

      expect(rows).toHaveLength(10);
      expect(rows.every((row) => row.usedAt === null)).toBe(true);

      // Cada linha guarda o SHA-256 do código normalizado, nunca o código.
      const hashes = new Set(rows.map((row) => row.codeHash));
      for (const code of recoveryCodes) {
        const expected = createHash('sha256')
          .update(code.replace(/-/g, ''))
          .digest('hex');
        expect(hashes.has(expected)).toBe(true);
      }
    });

    it('recusa um código errado na ativação', async () => {
      const agent = await authenticatedAgent(app);

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      const correto = codeFrom(secret);
      const errado = correto === '000001' ? '000002' : '000001';

      await agent
        .post('/auth/mfa/activate')
        .send({ code: errado })
        .expect(401);
    });

    it('recusa ativar sem ter começado a configuração', async () => {
      const agent = await authenticatedAgent(app);

      await agent
        .post('/auth/mfa/activate')
        .send({ code: '123456' })
        .expect(400);
    });

    it('recusa começar de novo quando já está ativo (409)', async () => {
      const { user, secret } = await userWithMfa(app);
      const agent = await mfaSession(app, user, secret);

      await agent.post('/auth/mfa/setup').expect(409);
    });
  });

  describe('login em duas etapas', () => {
    it('NÃO abre a sessão antes do código, e abre depois', async () => {
      const { user, secret } = await userWithMfa(app);

      const primeira = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(primeira.body.mfaRequired).toBe(true);
      // O ponto central: sem acesso ainda. Só o cookie do meio do login.
      expect(cookiePair(primeira, ACCESS_TOKEN_COOKIE)).toBeUndefined();
      expect(cookiePair(primeira, REFRESH_TOKEN_COOKIE)).toBeUndefined();

      const mfaCookie = cookiePair(primeira, MFA_TOKEN_COOKIE);
      expect(mfaCookie).toBeDefined();

      const segunda = await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('Cookie', mfaCookie!)
        .send({ code: codeFrom(secret) })
        .expect(200);

      expect(segunda.body.email).toBe(user.email);
      const accessCookie = cookiePair(segunda, ACCESS_TOKEN_COOKIE);
      expect(accessCookie).toBeDefined();

      // E a sessão aberta realmente vale.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', accessCookie!)
        .expect(200);
    });

    it('recusa um código errado na verificação', async () => {
      const { user, secret } = await userWithMfa(app);

      const primeira = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      const correto = codeFrom(secret);
      const errado = correto === '000001' ? '000002' : '000001';

      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('Cookie', cookiePair(primeira, MFA_TOKEN_COOKIE)!)
        .send({ code: errado })
        .expect(401);
    });

    it('recusa a verificação sem o cookie temporário', async () => {
      const { secret } = await userWithMfa(app);

      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ code: codeFrom(secret) })
        .expect(401);
    });

    it('aceita um pequeno desvio de relógio (período anterior)', async () => {
      const user = await seedUser(app);
      const agent = await login(app, user.email, user.password);

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      // Código de 30 s atrás: o passo ANTERIOR. Sem tolerância, seria recusado
      // e a pessoa concluiria que "o 2FA não funciona".
      await agent
        .post('/auth/mfa/activate')
        .send({ code: codeFrom(secret, 30) })
        .expect(200);
    });

    it('recusa um código fora da janela de tolerância', async () => {
      const user = await seedUser(app);
      const agent = await login(app, user.email, user.password);

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      // 90 s atrás: três períodos. A tolerância é de um período para cada
      // lado; aceitar isto seria aceitar qualquer coisa.
      await agent
        .post('/auth/mfa/activate')
        .send({ code: codeFrom(secret, 90) })
        .expect(401);
    });

    it('aceita um código de recuperação e o consome (uso único)', async () => {
      const { user, recoveryCodes } = await userWithMfa(app);

      // Entra com um código de recuperação, no lugar do código do aplicativo.
      const primeira = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('Cookie', cookiePair(primeira, MFA_TOKEN_COOKIE)!)
        .send({ code: recoveryCodes[0] })
        .expect(200);

      // O MESMO código não vale duas vezes.
      const segunda = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('Cookie', cookiePair(segunda, MFA_TOKEN_COOKIE)!)
        .send({ code: recoveryCodes[0] })
        .expect(401);

      // O consumo deixa rastro: exatamente um código marcado como usado.
      const rows = await app
        .get(DataSource)
        .getRepository(RecoveryCode)
        .find({ where: { userId: user.id } });
      expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
    });

    it('o token temporário NÃO vale como sessão', async () => {
      const { user } = await userWithMfa(app);

      const primeira = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      // O cookie do meio do login não abre nenhuma rota de sessão.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookiePair(primeira, MFA_TOKEN_COOKIE)!)
        .expect(401);
    });

    it('o token de ACESSO NÃO vale como token temporário', async () => {
      const user = await seedUser(app);
      const agent = await login(app, user.email, user.password);

      // Um token de acesso legítimo, capturado antes de ligar o 2FA.
      const loginSession = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      const accessToken = cookiePair(loginSession, ACCESS_TOKEN_COOKIE)!.split(
        '=',
      )[1];

      const setup = await agent.post('/auth/mfa/setup').expect(200);
      const secret = secretFromOtpauth(setup.body.otpauthUrl);

      // Colocá-lo no lugar do cookie temporário não pode funcionar: o `scope`
      // dentro dele não é 'mfa'.
      await request(app.getHttpServer())
        .post('/auth/mfa/verify')
        .set('Cookie', `${MFA_TOKEN_COOKIE}=${accessToken}`)
        .send({ code: codeFrom(secret) })
        .expect(401);
    });
  });

  describe('desligar o segundo fator', () => {
    it('exige um código válido para desligar', async () => {
      const { user, secret } = await userWithMfa(app);
      const agent = await mfaSession(app, user, secret);

      await agent
        .post('/auth/mfa/disable')
        .send({ code: '000001' })
        .expect(401);

      // Continua ativo — o código errado não desligou nada.
      const status = await agent.get('/auth/mfa').expect(200);
      expect(status.body.enabled).toBe(true);
    });

    it('desliga e o login volta a ser só senha', async () => {
      const { user, secret } = await userWithMfa(app);
      const agent = await mfaSession(app, user, secret);

      await agent
        .post('/auth/mfa/disable')
        .send({ code: codeFrom(secret) })
        .expect(204);

      const status = await agent.get('/auth/mfa').expect(200);
      expect(status.body).toEqual({ enabled: false, pending: false });

      // E o login deixa de pedir o código.
      const relogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      expect(relogin.body.mfaRequired).toBeUndefined();
      expect(relogin.body.email).toBe(user.email);
    });
  });
});
