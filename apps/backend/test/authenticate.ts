import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { User } from '../src/auth/user.entity.js';
import type { UserRole } from '../src/auth/user-role.js';

/**
 * Ajuda os testes a fazer o que o navegador faria: entrar no sistema.
 *
 * POR QUE ISTO PRECISOU EXISTIR.
 *
 * Antes da autenticação, os testes E2E chamavam a API direto e ela respondia.
 * Agora toda rota protegida exige sessão, e sem uma sessão a suíte inteira
 * levaria 401 — o que seria o comportamento CORRETO da API e um problema dos
 * testes.
 *
 * A TENTAÇÃO A EVITAR: o jeito errado de resolver isso é desligar o guard
 * durante os testes. Aí eles passam a validar uma aplicação que não existe em
 * produção, e a suíte fica verde enquanto a API real está fechada. Aqui os
 * testes logam DE VERDADE, pelo mesmo endpoint que o front usa.
 */

/**
 * Senha usada nos usuários de teste.
 *
 * Constante e longa o bastante para passar pela validação do seed. Não é
 * segredo de nada: mora no banco de TESTE, que é apagado a cada execução.
 */
export const TEST_USER_PASSWORD = 'senha-de-teste-longa-o-suficiente';

export interface SeededUser {
  id: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface SeedUserOptions {
  email?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
}

/**
 * Grava um usuário direto no banco de teste.
 *
 * Direto pelo repositório, e não pela API, porque não existe rota pública de
 * cadastro — de propósito. É o mesmo motivo de o seed ser um script.
 */
export async function seedUser(
  app: INestApplication<App>,
  options: SeedUserOptions = {},
): Promise<SeededUser> {
  const role = options.role ?? 'gerente';
  const email = options.email ?? `${role}@teste.local`;
  const password = options.password ?? TEST_USER_PASSWORD;

  const users = app.get(DataSource).getRepository(User);
  const id = randomUUID();

  await users.save(
    users.create({
      id,
      email,
      // Mesmo algoritmo da produção: um teste que usasse um hash simplificado
      // estaria validando um caminho que ninguém percorre de verdade.
      passwordHash: await argon2.hash(password),
      role,
      active: options.active ?? true,
    }),
  );

  return { id, email, password, role };
}

/**
 * Entra e devolve um agente que LEMBRA os cookies.
 *
 * `request.agent` é o detalhe que faz isso funcionar: um `request(...)` comum
 * descarta os `Set-Cookie` da resposta, então o login "daria certo" e a
 * requisição seguinte continuaria sem sessão. O agente guarda os cookies e os
 * reenvia sozinho, como o navegador.
 */
export async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());

  await agent.post('/auth/login').send({ email, password }).expect(200);

  return agent;
}

/**
 * O atalho usado pela maioria das suítes: cria o usuário e entra.
 *
 * O perfil padrão é `gerente` porque é o único que enxerga tudo — assim as
 * suítes de pagamento, volume e conciliação não precisam saber que a
 * autorização por perfil existe.
 */
export async function authenticatedAgent(
  app: INestApplication<App>,
  role: UserRole = 'gerente',
): Promise<ReturnType<typeof request.agent>> {
  const user = await seedUser(app, { role });

  return login(app, user.email, user.password);
}
