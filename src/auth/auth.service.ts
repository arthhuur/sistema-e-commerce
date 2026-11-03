import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { TokenService } from './token.service.js';
import { User } from './user.entity.js';
import { normalizeEmail } from './normalize-email.js';
import type { LoginDto } from './dto/login.dto.js';

export interface SessionResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

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
  ) {}

  async login(dto: LoginDto): Promise<SessionResult> {
    const user = await this.verifyCredentials(dto.email, dto.password);
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
