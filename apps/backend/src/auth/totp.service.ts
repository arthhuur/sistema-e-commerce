import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OTP } from 'otplib';
import QRCode from 'qrcode';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { RecoveryCode } from './recovery-code.entity.js';
import { User } from './user.entity.js';
import { decryptSecret, encryptSecret } from './secret-cipher.js';

/**
 * O segundo fator (TOTP), de ponta a ponta.
 *
 * O QUE É TOTP, EM UMA FRASE: um código de seis dígitos que muda a cada 30
 * segundos, calculado a partir de um segredo compartilhado e do relógio. Como
 * os dois lados sabem o segredo e o horário, não é preciso rede nem mensagem:
 * o aplicativo autenticador gera o código, o servidor recalcula e compara.
 *
 * O QUE ISTO ACRESCENTA DE VERDADE: a senha sozinha é um segredo que a pessoa
 * CONTOU. TOTP é um segredo que ela POSSUI (o celular). Roubar a senha, por
 * phishing ou vazamento, deixa de bastar — o atacante também precisa do
 * aparelho. É por isso que o 2FA é a defesa com maior retorno por esforço.
 *
 * A BIBLIOTECA É O `otplib`, E A ESCOLHA É DELIBERADA. O TOTP tem uma
 * implementação de referência curta, mas os detalhes que erram silenciosamente
 * — a base32 do segredo, o HMAC-SHA1, o truncamento dinâmico — são exatamente
 * os que não se percebe ter errado até alguém não conseguir entrar. Cripto
 * própria é o tipo de código que parece funcionar e falha no caso de borda.
 */

/** Nome que aparece no aplicativo autenticador, ao lado da conta. */
const ISSUER = 'Payment Router';

/** Quantos códigos de recuperação são gerados por configuração. */
const RECOVERY_CODE_COUNT = 10;

/** 10 caracteres é longo o bastante para não ser adivinhado. */
const RECOVERY_CODE_LENGTH = 10;

/**
 * O alfabeto dos códigos de recuperação.
 *
 * SEM `I`, `O`, `0` e `1`, de propósito: são os caracteres que as pessoas
 * confundem ao ler um código de um papel e digitar. Tirá-los custa nada e
 * evita o suporte "meu código não funciona" que na verdade é um `0` lido como
 * `O`. São 32 símbolos, e 256 é divisível por 32 — então o sorteio por resto
 * não tem viés.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Tolerância de tempo na conferência, em segundos.
 *
 * UM CÓDIGO VÁLIDO POR 30 SEGUNDOS SERIA INJUSTO. O relógio do celular
 * atrasa, o do servidor adianta, a pessoa digita no último instante. Sem
 * tolerância, códigos corretos são recusados e a conclusão é "o 2FA está
 * quebrado". Aceitando 30 segundos para trás e para frente — o passo anterior
 * e o seguinte —, resolve-se o desvio sem praticamente enfraquecer nada (o
 * espaço de códigos ainda é de um milhão, e o limite de tentativas continua
 * valendo). É exatamente a janela que a RFC 6238 recomenda.
 */
const TOTP_TOLERANCE_SECONDS = 30;

const TOTP_PATTERN = /^\d{6}$/;

export interface TotpEnrollment {
  /** URL `otpauth://` que o aplicativo entende. */
  otpauthUrl: string;
  /** O mesmo conteúdo em QR Code, como data URL pronta para um `<img src>`. */
  qrDataUrl: string;
}

export interface TotpStatus {
  /** O segundo fator está valendo: o login já pede o código. */
  enabled: boolean;
  /** Configuração começada e não confirmada: existe um segredo, mas ele não vale. */
  pending: boolean;
}

@Injectable()
export class TotpService {
  private readonly totp = new OTP({ strategy: 'totp' });

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RecoveryCode)
    private readonly recoveryCodes: Repository<RecoveryCode>,
  ) {}

  /**
   * Primeiro tempo da configuração: gera o segredo e devolve o QR Code.
   *
   * O 2FA ainda NÃO passa a valer aqui — veja `totpEnabledAt` na entidade.
   * Chamar de novo sobrescreve o segredo anterior, e isso é intencional: um QR
   * Code que a pessoa não conseguiu escanear precisa poder ser substituído.
   */
  async beginEnrollment(userId: string): Promise<TotpEnrollment> {
    const user = await this.loadWithSecret(userId);

    if (user.totpEnabledAt) {
      throw new ConflictException('O segundo fator já está ativo nesta conta.');
    }

    const secret = this.totp.generateSecret();
    const otpauthUrl = this.totp.generateURI({
      issuer: ISSUER,
      label: user.email,
      secret,
    });

    // O QR é gerado aqui e sai como data URL (o PNG embutido em base64), para
    // o front só precisar de um `<img src>`. Sem isso, o front teria de
    // carregar uma biblioteca de QR só para desenhar o que a API já sabe.
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 240,
      margin: 1,
    });

    // O segredo é gravado CIFRADO. Ele nunca é devolvido separado — quem quiser
    // lê-lo está no próprio otpauthUrl, e é para lá (o QR) que ele deve ir.
    await this.users.update(
      { id: userId },
      { totpSecret: encryptSecret(secret) },
    );

    return { otpauthUrl, qrDataUrl };
  }

  /**
   * Segundo tempo: confere um código e SÓ ENTÃO liga o 2FA.
   *
   * Devolve os códigos de recuperação em texto puro — a única vez que eles
   * existem fora do hash. Depois desta resposta, nem o servidor consegue
   * mostrá-los de novo.
   */
  async activate(userId: string, code: string): Promise<string[]> {
    const user = await this.loadWithSecret(userId);

    if (user.totpEnabledAt) {
      throw new ConflictException('O segundo fator já está ativo nesta conta.');
    }

    if (!user.totpSecret) {
      throw new BadRequestException(
        'Inicie a configuração do segundo fator antes de confirmar o código.',
      );
    }

    if (!this.totpMatches(this.decryptedSecret(user.totpSecret), code)) {
      throw new UnauthorizedException(
        'Código incorreto. Confira se o aplicativo está sincronizado e tente novamente.',
      );
    }

    const recoveryCodes = this.generateRecoveryCodes();

    // Transação: ligar o 2FA e gravar os códigos acontecem juntos. Se a
    // gravação dos códigos falhasse depois de o 2FA já valer, a pessoa teria
    // o fator ligado e nenhuma saída de emergência.
    await this.users.manager.transaction(async (manager) => {
      await manager.update(
        User,
        { id: userId },
        { totpEnabledAt: new Date() },
      );

      const repository = manager.getRepository(RecoveryCode);

      // Limpa códigos antigos (de uma configuração anterior) antes de gravar
      // os novos — senão eles continuariam válidos.
      await repository.delete({ userId });

      await repository.save(
        recoveryCodes.map((recoveryCode) =>
          repository.create({
            id: randomUUID(),
            userId,
            // O hash é do código NORMALIZADO (sem o traço), que é exatamente o
            // que `consumeRecoveryCode` calcula ao conferir. Gravar o hash do
            // código COM o traço faria a conferência nunca encontrar nada.
            codeHash: hashRecoveryCode(this.normalizeRecoveryCode(recoveryCode)),
            usedAt: null,
          }),
        ),
      );
    });

    return recoveryCodes;
  }

  /**
   * Desliga o 2FA. Exige um código válido — do aplicativo OU de recuperação.
   *
   * Exigir o código aqui é o que impede o pior cenário: uma sessão roubada
   * (um computador deixado aberto, um cookie copiado) usada para DESLIGAR o
   * segundo fator e depois entrar sem ele. Sem esta conferência, o 2FA
   * protegeria só a porta da frente e deixaria a de trás escancarada.
   */
  async disable(userId: string, code: string): Promise<void> {
    await this.assertValidCode(userId, code);

    await this.users.update(
      { id: userId },
      { totpSecret: null, totpEnabledAt: null },
    );
    await this.recoveryCodes.delete({ userId });
  }

  async status(userId: string): Promise<TotpStatus> {
    const user = await this.loadWithSecret(userId);
    const enabled = user.totpEnabledAt !== null;

    return {
      enabled,
      pending: !enabled && user.totpSecret !== null,
    };
  }

  /**
   * Confere um código do aplicativo OU um código de recuperação.
   *
   * É a única porta de verificação, usada tanto pelo login em duas etapas
   * quanto pelo desligamento — assim não existe um caminho que aceite um
   * código e outro que aceite menos.
   */
  async assertValidCode(userId: string, code: string): Promise<void> {
    const user = await this.loadWithSecret(userId);

    if (!user.totpEnabledAt) {
      throw new BadRequestException(
        'O segundo fator não está ativo nesta conta.',
      );
    }

    if (this.totpMatches(this.decryptedSecret(user.totpSecret), code)) {
      return;
    }

    if (await this.consumeRecoveryCode(userId, code)) {
      return;
    }

    // A mensagem é a mesma para "código do aplicativo errado" e "código de
    // recuperação inválido": quem está tentando entrar só precisa saber que
    // não passou.
    throw new UnauthorizedException('Código de verificação incorreto.');
  }

  /**
   * Queima um código de recuperação, se ele existir e ainda não tiver sido
   * usado.
   *
   * O CONSUMO É UM `UPDATE` CONDICIONAL, e isso não é detalhe de estilo. Um
   * `findOne` seguido de `update` teria uma janela entre ler e escrever: duas
   * requisições simultâneas com o mesmo código passariam as duas. Aqui o
   * filtro `usedAt IS NULL` faz o próprio banco decidir quem chega primeiro —
   * a segunda atualização não encontra linha nenhuma e recebe "incorreto".
   */
  private async consumeRecoveryCode(
    userId: string,
    code: string,
  ): Promise<boolean> {
    const normalized = this.normalizeRecoveryCode(code);

    if (normalized.length !== RECOVERY_CODE_LENGTH) {
      return false;
    }

    const result = await this.recoveryCodes.update(
      { userId, codeHash: hashRecoveryCode(normalized), usedAt: IsNull() },
      { usedAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  private totpMatches(secret: string | undefined, code: string): boolean {
    // Segredo ausente ou irrecuperável (chave de cifra diferente da que
    // gravou). Em qualquer um dos casos a resposta é a mesma: não confere.
    if (!secret) {
      return false;
    }

    const token = code.replace(/\s+/g, '');

    // Cortar antes de chamar a biblioteca: um valor que não é de seis dígitos
    // nem chega a virar cálculo.
    if (!TOTP_PATTERN.test(token)) {
      return false;
    }

    try {
      return this.totp.verifySync({
        secret,
        token,
        epochTolerance: TOTP_TOLERANCE_SECONDS,
      }).valid;
    } catch {
      // Segredo em formato que a biblioteca não aceita não pode virar erro
      // 500: para quem está entrando, o resultado é o mesmo — não confere.
      return false;
    }
  }

  private decryptedSecret(encrypted: string | null): string | undefined {
    if (!encrypted) {
      return undefined;
    }

    try {
      return decryptSecret(encrypted);
    } catch {
      return undefined;
    }
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      this.randomRecoveryCode(),
    );
  }

  private randomRecoveryCode(): string {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    let raw = '';

    for (const byte of bytes) {
      raw += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }

    // O traço é só de leitura, para o olho agrupar. A conferência o descarta.
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  }

  /** Tira o traço, o espaço e a caixa: o que vale é o conteúdo. */
  private normalizeRecoveryCode(code: string): string {
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  /**
   * Carrega o usuário COM o segredo do TOTP.
   *
   * A coluna é `select: false`, então precisa ser pedida. Ficou centralizado
   * aqui justamente para que ninguém esqueça o `select` e conclua, sem
   * perceber, que a pessoa "não tem segredo".
   */
  private async loadWithSecret(userId: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        active: true,
        totpSecret: true,
        totpEnabledAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return user;
  }
}

/**
 * O hash do código de recuperação.
 *
 * SHA-256 e não argon2, pelo mesmo motivo do refresh token: o código é
 * ALEATÓRIO e longo, então não existe dicionário nem força bruta a temer. O
 * custo artificial do argon2 só faz sentido onde a entrada é escolhida por
 * humano (a senha).
 */
function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
