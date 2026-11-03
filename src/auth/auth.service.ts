import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { TokenService } from './token.service.js';
import { TotpService } from './totp.service.js';
import { User } from './user.entity.js';
import { normalizeEmail } from './normalize-email.js';
import type { LoginDto } from './dto/login.dto.js';

export interface SessionResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/**
 * O que o login devolve: uma sessão PRONTA ou um pedido de segundo fator.
 *
 * O `kind` explícito existe para o controller ser obrigado a tratar os dois
 * casos. Se os dois virassem "o mesmo retorno com campos faltando", esquecer
 * o segundo fator seria fácil — e o resultado seria uma sessão aberta sem
 * pedir o código, o pior desfecho possível para esta feature.
 */
export type LoginResult =
  | { kind: 'session'; session: SessionResult }
  | { kind: 'mfa'; mfaToken: string };

/**
 * A MESMA mensagem para todo tipo de falha no login.
 *
 * Isso é deliberado. Se respondêssemos "e-mail não cadastrado" quando o
 * e-mail não existe e "senha incorreta" quando existe, o sistema viraria um
 * verificador de cadastro: qualquer pessoa poderia descobrir quem tem conta
 * na loja testando e-mails. Do lado de fora, as duas falhas precisam ser
 * indistinguíveis.
 */
const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

/**
 * A "cozinha" da autenticação: confere a senha e abre a sessão.
 */
@Injectable()
export class AuthService {
  /**
   * Um hash descartável, usado só quando o e-mail NÃO existe.
   *
   * O PROBLEMA QUE ISSO RESOLVE É SUTIL. O argon2 é lento de propósito. Se,
   * ao não encontrar o usuário, o método retornasse na hora, a resposta
   * chegaria em ~1 ms. Quando o usuário existe, ela levaria ~100 ms, o tempo
   * do hash. Essa diferença é medível, e medindo-a um atacante descobre quais
   * e-mails estão cadastrados — sem precisar acertar senha alguma.
   *
   * Verificando contra um hash falso, os dois caminhos gastam o mesmo tempo e
   * a diferença desaparece.
   *
   * O valor é calculado uma única vez e reaproveitado (a promessa fica em
   * cache) para não pagar o custo do hash a cada tentativa inválida.
   */
  private dummyHash: Promise<string> | undefined;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tokenService: TokenService,
    private readonly totpService: TotpService,
  ) {}

  /**
   * Confere a senha e decide se a sessão abre ou se falta o segundo fator.
   *
   * A ORDEM IMPORTA E NÃO É NEGOCIÁVEL: a senha é conferida PRIMEIRO, e o
   * segundo fator só entra depois dela. O contrário deixaria um token de MFA
   * emitido para quem não provou nada — bastaria ter um e-mail cadastrado.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.verifyCredentials(dto.email, dto.password);

    if (user.totpEnabledAt) {
      return {
        kind: 'mfa',
        mfaToken: await this.tokenService.signMfaToken(user.id),
      };
    }

    return { kind: 'session', session: await this.startSession(user) };
  }

  /**
   * A segunda etapa do login: confere o código e abre a sessão.
   *
   * O `mfaToken` diz de quem é a confirmação. Repare que ele NÃO substitui a
   * senha: ele só existe depois de a senha ter sido aceita, e vale poucos
   * minutos. É a ponte entre as duas etapas.
   */
  async completeMfaLogin(
    mfaToken: string | undefined,
    code: string,
  ): Promise<SessionResult> {
    const userId = await this.tokenService.verifyMfaToken(mfaToken);

    const user = await this.users.findOne({ where: { id: userId } });

    // A conta pode ter sido desativada entre as duas etapas. Tratar aqui é o
    // que fecha essa janela, por menor que seja.
    if (!user || !user.active) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    await this.totpService.assertValidCode(user.id, code);

    return this.startSession(user);
  }

  /**
   * Renova a sessão a partir do refresh token.
   *
   * Repare que aqui o banco É consultado, e isso é intencional: é o único
   * momento em que dá para saber se o usuário ainda está ativo e se a sessão
   * foi revogada. Um token de acesso vencido não conta essa história.
   */
  async refresh(rawToken: string | undefined): Promise<SessionResult> {
    if (!rawToken) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    const rotated = await this.tokenService.rotateRefreshToken(rawToken);

    const user = await this.users.findOne({ where: { id: rotated.userId } });

    // Usuário apagado ou desativado não renova. E derrubamos tudo dele por
    // garantia: sem isso, um acesso desligado hoje continuaria renovando.
    if (!user || !user.active) {
      await this.tokenService.revokeAllForUser(rotated.userId);
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    const accessToken = await this.tokenService.signAccessToken(user);

    return { user, accessToken, refreshToken: rotated.refreshToken };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.tokenService.revokeRefreshToken(rawToken);
  }

  async findById(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });

    if (!user || !user.active) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    return user;
  }

  private async startSession(user: User): Promise<SessionResult> {
    const accessToken = await this.tokenService.signAccessToken(user);
    const refreshToken = await this.tokenService.issueRefreshToken(user.id);

    return { user, accessToken, refreshToken };
  }

  private async verifyCredentials(
    email: string,
    password: string,
  ): Promise<User> {
    const user = await this.users.findOne({
      where: { email: normalizeEmail(email) },
    });

    if (!user || !user.active) {
      await this.burnSameTimeAsARealVerification(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!(await this.passwordMatches(user.passwordHash, password))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return user;
  }

  private async passwordMatches(
    hash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Hash corrompido ou em formato desconhecido não pode virar erro 500:
      // para quem está entrando, o resultado é o mesmo — senha não confere.
      return false;
    }
  }

  private async burnSameTimeAsARealVerification(
    password: string,
  ): Promise<void> {
    this.dummyHash ??= argon2.hash(randomBytes(32).toString('hex'));

    await this.passwordMatches(await this.dummyHash, password);
  }
}
