import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ACCESS_TOKEN_TTL_SECONDS, MFA_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './auth.constants.js';
import { RefreshToken } from './refresh-token.entity.js';
import type { User } from './user.entity.js';
import type {
  AccessTokenPayload,
  MfaTokenPayload,
} from './authenticated-user.js';

/**
 * Quem emite, confere e revoga os tokens da sessão.
 *
 * Separado do AuthService de propósito: aqui é sobre CREDENCIAL (assinar,
 * guardar, expirar, revogar); lá é sobre IDENTIDADE (quem é a pessoa, a senha
 * confere, ela está ativa). Misturar os dois é como um Service acaba com
 * quinze métodos e nenhum assunto.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /**
   * Assina o token de acesso.
   *
   * Ele NÃO é consultado no banco a cada requisição — a assinatura é a prova.
   * O preço dessa conveniência é a janela de 15 minutos: se o perfil de
   * alguém mudar, o token antigo continua dizendo o perfil antigo até vencer.
   * É um trade-off aceito e comum; encurtar a validade reduz a janela, e o
   * refresh sempre reconsulta o banco.
   */
  async signAccessToken(user: User): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * Emite o token intermediário do login em duas etapas.
   *
   * Ele é assinado com o MESMO segredo do token de acesso, mas carrega
   * `scope: 'mfa'` — e é isso que o impede de valer como sessão (e vice-versa).
   * A validade é curta porque ele só existe para atravessar a digitação do
   * código.
   */
  async signMfaToken(userId: string): Promise<string> {
    const payload: MfaTokenPayload = { sub: userId, scope: 'mfa' };

    return this.jwtService.signAsync(payload, {
      expiresIn: MFA_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * Confere o token intermediário e devolve de quem ele é.
   *
   * Recusa qualquer coisa que não seja exatamente um token de MFA — inclusive
   * um token de acesso válido, que não tem o `scope`. A mensagem é a mesma em
   * todos os casos: quem está do outro lado só precisa saber que a etapa
   * expirou e que deve entrar de novo.
   */
  async verifyMfaToken(token: string | undefined): Promise<string> {
    const expired = new UnauthorizedException(
      'A confirmação do segundo fator expirou. Entre novamente.',
    );

    if (!token) {
      throw expired;
    }

    let payload: MfaTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<MfaTokenPayload>(token);
    } catch {
      throw expired;
    }

    if (payload.scope !== 'mfa' || !payload.sub) {
      throw expired;
    }

    return payload.sub;
  }

  /**
   * Gera um refresh token e guarda apenas o hash dele.
   *
   * O texto puro sai daqui UMA vez, para virar cookie, e não é guardado em
   * lugar nenhum. Se o banco vazar, não há sessão para usar.
   */
  async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = this.generateRawToken();

    await this.refreshTokens.save(
      this.refreshTokens.create({
        id: randomUUID(),
        userId,
        tokenHash: this.hash(rawToken),
        expiresAt: this.expiryDate(),
        revokedAt: null,
      }),
    );

    return rawToken;
  }

  /**
   * Troca um refresh token válido por um par novo (rotação).
   *
   * A ROTAÇÃO É O PONTO TODO. Cada renovação invalida o token usado e emite
   * outro. Isso limita o dano de um cookie copiado: ele só serve uma vez.
   *
   * E dá um sinal valioso: se um token JÁ USADO reaparece, só existem duas
   * explicações — dois dispositivos compartilhando o mesmo cookie, ou alguém
   * copiou. Como não dá para distinguir, tratamos como o pior caso: derrubar
   * TODAS as sessões daquele usuário. É melhor reconectar do que conviver com
   * um invasor logado.
   */
  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const record = await this.refreshTokens.findOne({
      where: { tokenHash: this.hash(rawToken) },
    });

    if (!record) {
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    if (record.revokedAt !== null) {
      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.refreshTokens.update(
        { id: record.id },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('Sessão ausente ou inválida.');
    }

    // Transação: revogar o antigo e gravar o novo acontecem juntos. Sem isso,
    // uma queda no meio deixaria o usuário sem nenhum token válido.
    return this.refreshTokens.manager.transaction(async (manager) => {
      await manager.update(
        RefreshToken,
        { id: record.id },
        { revokedAt: new Date() },
      );

      const repository = manager.getRepository(RefreshToken);
      const newRawToken = this.generateRawToken();

      await repository.save(
        repository.create({
          id: randomUUID(),
          userId: record.userId,
          tokenHash: this.hash(newRawToken),
          expiresAt: this.expiryDate(),
          revokedAt: null,
        }),
      );

      return { userId: record.userId, refreshToken: newRawToken };
    });
  }

  /**
   * Encerra a sessão do dono deste token (logout).
   *
   * Não reclama se o token não existir: um logout repetido não é erro, e
   * devolver 401 aqui faria o front achar que falhou quando na verdade a
   * sessão já estava encerrada.
   */
  async revokeRefreshToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    await this.refreshTokens.update(
      { tokenHash: this.hash(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Derruba todas as sessões de um usuário.
   *
   * Usado quando um token já revogado reaparece (sinal de cópia) e quando o
   * usuário é desativado — nesse último caso, sem isto ele continuaria
   * renovando a sessão para sempre.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Os dois lados precisam do MESMO valor para se encontrarem: guardamos o
   * hash e procuramos pelo hash. Assim o texto puro nunca toca o banco.
   */
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * 32 bytes de aleatoriedade de verdade.
   *
   * `Math.random()` NÃO serve aqui: é previsível. Um token de sessão precisa
   * vir do gerador criptográfico do sistema operacional.
   */
  private generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private expiryDate(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }
}
