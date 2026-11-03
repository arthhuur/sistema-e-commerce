import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../database/data-source.js';
import { User } from './user.entity.js';
import { normalizeEmail } from './normalize-email.js';
import { USER_ROLES, isUserRole } from './user-role.js';

/**
 * Cria (ou redefine) um usuário do sistema.
 *
 * POR QUE ISTO EXISTE.
 *
 * Toda aplicação com login tem um problema de ovo e galinha: para entrar no
 * sistema e cadastrar pessoas, você precisa estar dentro do sistema. Alguém
 * tem de nascer primeiro. Este script é essa porta dos fundos — usada uma vez
 * na vida, na primeira subida, e depois como ferramenta de socorro quando
 * ninguém consegue mais entrar.
 *
 * POR QUE UM SCRIPT, E NÃO UMA ROTA DE CADASTRO ABERTA.
 *
 * Uma rota pública de "primeiro cadastro" é uma porta que precisa ser fechada
 * depois, e esse tipo de porta costuma ficar aberta para sempre — é assim que
 * sistemas de verdade são invadidos. Um script roda na máquina (ou no shell do
 * servidor), exige acesso ao ambiente, e não deixa superfície exposta na
 * internet.
 *
 * COMO USAR
 *
 *   npm run seed:user -- --email=gerente@loja.com --password=uma-senha-longa
 *   npm run seed:user -- --email=ana@loja.com --password=outra-senha --role=estoque
 *
 * Rodar de novo com o MESMO e-mail não duplica nada: atualiza a senha, o
 * perfil e reativa a conta. É de propósito — sem isso, quem perdesse a senha
 * do gerente ficaria trancado fora do próprio sistema para sempre.
 */

/** Perfis aceitos: a mesma lista que o resto do sistema usa. */
const DEFAULT_ROLE = 'gerente';

/**
 * Teto maior que o da tela de login, e a diferença tem motivo.
 *
 * O login aceita 8 caracteres porque precisa atender senhas que JÁ existem.
 * Aqui estamos CRIANDO a senha, e este é o usuário mais poderoso do sistema.
 * É o único momento em que dá para exigir mais sem quebrar ninguém.
 */
const MINIMUM_PASSWORD_LENGTH = 12;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));

  return found?.slice(prefix.length);
}

function fail(message: string): never {
  console.error(`\n  Erro: ${message}\n`);
  process.exit(1);
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main(): Promise<void> {
  const email = normalizeEmail(option('email') ?? '');
  const password = option('password') ?? '';
  const role = option('role') ?? DEFAULT_ROLE;

  if (!email || !password) {
    fail(
      'Faltam dados. Use assim:\n\n' +
        '    npm run seed:user -- --email=gerente@loja.com --password=uma-senha-longa\n\n' +
        '  Opcionalmente, o perfil (padrão: gerente):\n\n' +
        '    npm run seed:user -- --email=ana@loja.com --password=uma-senha-longa --role=estoque\n',
    );
  }

  if (!looksLikeEmail(email)) {
    fail(`O e-mail "${email}" não parece válido.`);
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    fail(
      `A senha precisa ter ao menos ${MINIMUM_PASSWORD_LENGTH} caracteres ` +
        `(recebida: ${password.length}). Este é o usuário com mais poder no sistema.`,
    );
  }

  if (!isUserRole(role)) {
    fail(
      `O perfil "${role}" não existe. Os válidos são: ${USER_ROLES.join(', ')}.`,
    );
  }

  await AppDataSource.initialize();

  try {
    const users = AppDataSource.getRepository(User);

    // O hash é calculado ANTES de decidir criar ou atualizar, porque os dois
    // caminhos precisam dele. E é a única forma de a senha existir: ela não é
    // guardada em nenhum lugar, nem por um instante.
    const passwordHash = await argon2.hash(password);

    const existing = await users.findOne({ where: { email } });

    if (existing) {
      await users.update(
        { id: existing.id },
        { passwordHash, role, active: true },
      );

      console.log(`\n  Senha redefinida.`);
      console.log(`  E-mail: ${email}`);
      console.log(`  Perfil: ${role}`);
      console.log(`  Conta reativada, se estivesse desligada.\n`);
      return;
    }

    await users.save(
      users.create({
        id: randomUUID(),
        email,
        passwordHash,
        role,
        active: true,
      }),
    );

    console.log(`\n  Usuário criado.`);
    console.log(`  E-mail: ${email}`);
    console.log(`  Perfil: ${role}`);
    console.log(`\n  Já dá para entrar por POST /auth/login.\n`);
  } finally {
    // Fechar a conexão explicitamente; sem isto o processo fica pendurado
    // esperando o pool, e o comando parece ter travado depois de terminar.
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  // O erro mais provável de quem roda isto pela primeira vez é o banco ainda
  // sem as tabelas. A mensagem crua do Postgres não sugere o que fazer, então
  // traduzimos para a ação que resolve.
  if (message.includes('does not exist')) {
    fail(
      `As tabelas ainda não existem no banco.\n` +
        `  Rode as migrations primeiro:\n\n` +
        `    npm run migration:run\n\n` +
        `  Detalhe original: ${message}`,
    );
  }

  fail(message);
});
