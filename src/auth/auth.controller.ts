import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import type { SessionResult } from './auth.service.js';
import { TotpService } from './totp.service.js';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  MFA_TOKEN_COOKIE,
  MFA_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
  sessionCookieOptions,
} from './auth.constants.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto.js';
import { MfaCodeDto } from './dto/mfa-code.dto.js';
import {
  MfaChallengeDto,
  MfaRecoveryCodesResponseDto,
  MfaSetupResponseDto,
  MfaStatusResponseDto,
} from './dto/mfa-responses.dto.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import type { User } from './user.entity.js';

/**
 * As portas de entrada e saída da sessão.
 *
 * Por que a resposta NÃO devolve o token no corpo:
 *
 * O caminho comum é responder `{ token: "..." }` e o front guardar. Foi
 * justamente esse desenho que abre a porta para o XSS roubar a sessão: o que
 * está no corpo vira JavaScript, e o que vira JavaScript um script malicioso
 * lê. Aqui o token sai apenas como cookie `httpOnly`, que o JavaScript da
 * página é incapaz de ler, mesmo comprometido.
 *
 * O corpo devolve só quem entrou — o suficiente para a tela montar o menu
 * conforme o perfil.
 */
@ApiTags('Auth')
@Controller('auth')
// O ThrottlerGuard fica SÓ neste controller de propósito. É aqui que a força
// bruta acontece (adivinhar senha). Nas rotas de pagamento ele atrapalharia
// sem proteger nada — e ainda quebraria os testes de volume.
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica (primeira etapa) e abre a sessão',
    description:
      'Confere e-mail e senha. Sem segundo fator ativo, grava dois cookies httpOnly (acesso de 15 min e renovação de 7 dias). ' +
      'Com segundo fator ativo, NÃO abre sessão: devolve { mfaRequired: true } e grava um cookie temporário, e o login só se completa em POST /auth/mfa/verify. ' +
      'Em caso de falha, a mensagem é sempre a mesma, para não revelar se o e-mail existe.',
  })
  @ApiOkResponse({
    description:
      'Sessão aberta (sem 2FA) ou segundo fator exigido (mfaRequired: true).',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/AuthenticatedUserDto' },
        { $ref: '#/components/schemas/MfaChallengeDto' },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'E-mail ou senha incorretos.' })
  @ApiTooManyRequestsResponse({
    description: 'Tentativas demais em pouco tempo.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUserDto | MfaChallengeDto> {
    const result = await this.authService.login(dto);

    if (result.kind === 'mfa') {
      this.writeMfaCookie(res, result.mfaToken);

      return { mfaRequired: true };
    }

    this.writeSessionCookies(res, result.session);

    return toAuthenticatedUserDto(result.session.user);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Segunda etapa do login: confirma o código e abre a sessão',
    description:
      'Recebe o código do aplicativo (6 dígitos) ou um código de recuperação, junto do cookie temporário gravado no login. ' +
      'Aceita pequena diferença de relógio entre o aparelho e o servidor. Em caso de acerto, abre a sessão e descarta o cookie temporário.',
  })
  @ApiOkResponse({ description: 'Sessão aberta.', type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({
    description: 'Código incorreto ou etapa expirada.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Tentativas demais em pouco tempo.',
  })
  async verifyMfa(
    @Body() dto: MfaCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUserDto> {
    const session = await this.authService.completeMfaLogin(
      req.cookies?.[MFA_TOKEN_COOKIE],
      dto.code,
    );

    this.clearMfaCookie(res);
    this.writeSessionCookies(res, session);

    return toAuthenticatedUserDto(session.user);
  }

  @Get('mfa')
  @ApiOperation({
    summary: 'Situação do segundo fator',
    description:
      'Diz se o 2FA está ativo e se há uma configuração começada e não confirmada. É o que o front chama para decidir entre "ativar" e "desativar".',
  })
  @ApiOkResponse({ type: MfaStatusResponseDto })
  async mfaStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MfaStatusResponseDto> {
    return this.totpService.status(user.id);
  }

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Começa a configuração do segundo fator',
    description:
      'Gera um segredo novo e devolve a URL otpauth:// e o QR Code em data URL. O 2FA AINDA NÃO passa a valer: ' +
      'confirme um código em POST /auth/mfa/activate. Chamar de novo substitui o segredo anterior, então um QR Code mal escaneado pode ser refeito.',
  })
  @ApiOkResponse({ type: MfaSetupResponseDto })
  @ApiConflictResponse({ description: 'O segundo fator já está ativo.' })
  async startMfaSetup(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MfaSetupResponseDto> {
    return this.totpService.beginEnrollment(user.id);
  }

  @Post('mfa/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirma e liga o segundo fator',
    description:
      'Confere um código gerado pelo aplicativo e, se estiver correto, liga o 2FA e devolve os códigos de recuperação. ' +
      'Eles aparecem UMA única vez — guarde-os fora do celular. Depois disso o login passa a pedir o código.',
  })
  @ApiOkResponse({ type: MfaRecoveryCodesResponseDto })
  @ApiBadRequestResponse({ description: 'A configuração não foi iniciada.' })
  @ApiUnauthorizedResponse({ description: 'Código incorreto.' })
  @ApiConflictResponse({ description: 'O segundo fator já está ativo.' })
  async activateMfa(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MfaRecoveryCodesResponseDto> {
    const recoveryCodes = await this.totpService.activate(user.id, dto.code);

    return { recoveryCodes };
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Desliga o segundo fator',
    description:
      'Exige um código válido — do aplicativo ou de recuperação — para desligar. Sem essa exigência, uma sessão roubada poderia remover o 2FA e entrar sem ele.',
  })
  @ApiNoContentResponse({ description: 'Segundo fator desligado.' })
  @ApiUnauthorizedResponse({ description: 'Código incorreto.' })
  @ApiBadRequestResponse({ description: 'O segundo fator não está ativo.' })
  async disableMfa(
    @Body() dto: MfaCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.totpService.disable(user.id, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renova a sessão',
    description:
      'Troca o cookie de renovação por um par novo. O token usado é invalidado na mesma transação (rotação): ' +
      'se um token já usado reaparecer, todas as sessões do usuário são derrubadas.',
  })
  @ApiOkResponse({ description: 'Sessão renovada.', type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ description: 'Sessão ausente, vencida ou revogada.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUserDto> {
    const session = await this.authService.refresh(
      req.cookies?.[REFRESH_TOKEN_COOKIE],
    );
    this.writeSessionCookies(res, session);

    return toAuthenticatedUserDto(session.user);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerra a sessão',
    description:
      'Revoga o token de renovação no banco e apaga os cookies. Repetir a chamada não é erro.',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req.cookies?.[REFRESH_TOKEN_COOKIE]);
    this.clearSessionCookies(res);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Quem está logado',
    description:
      'Devolve o usuário da sessão atual. É esta rota que o front chama ao abrir a aplicação para saber se a sessão ainda vale ' +
      'e qual menu montar. Consulta o banco em vez de confiar no token, para refletir mudanças de perfil na hora.',
  })
  @ApiOkResponse({ description: 'Usuário da sessão.', type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ description: 'Sem sessão válida.' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUserDto> {
    // Nada de devolver o que veio do token: o perfil pode ter mudado desde a
    // emissão, e aqui é o momento certo para contar a verdade atual.
    return toAuthenticatedUserDto(await this.authService.findById(user.id));
  }

  private writeSessionCookies(res: Response, session: SessionResult): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      session.accessToken,
      sessionCookieOptions(ACCESS_TOKEN_TTL_SECONDS),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      session.refreshToken,
      sessionCookieOptions(REFRESH_TOKEN_TTL_SECONDS),
    );
  }

  /**
   * Grava o cookie temporário da segunda etapa.
   *
   * Ele usa as MESMAS opções de segurança dos cookies de sessão (`httpOnly`,
   * `secure`, `sameSite`), apesar de não ser uma sessão. É de propósito: se o
   * JavaScript conseguisse lê-lo, um XSS poderia completar o login sozinho na
   * posse da senha, e a segunda etapa não teria servido de nada.
   */
  private writeMfaCookie(res: Response, mfaToken: string): void {
    res.cookie(
      MFA_TOKEN_COOKIE,
      mfaToken,
      sessionCookieOptions(MFA_TOKEN_TTL_SECONDS),
    );
  }

  private clearMfaCookie(res: Response): void {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions(0);

    res.clearCookie(MFA_TOKEN_COOKIE, options);
  }

  private clearSessionCookies(res: Response): void {
    // O caminho (`path`) precisa ser o MESMO usado ao gravar. Só o nome não
    // basta: o navegador trata cookies de caminhos diferentes como cookies
    // diferentes, e o logout "funcionaria" deixando a sessão viva.
    //
    // O `maxAge` é descartado de propósito: quem manda o cookie vencer é a
    // data de expiração que o `clearCookie` grava, não um tempo de vida.
    const { maxAge: _maxAge, ...options } = sessionCookieOptions(0);

    res.clearCookie(ACCESS_TOKEN_COOKIE, options);
    res.clearCookie(REFRESH_TOKEN_COOKIE, options);
  }
}

/**
 * Converte a entidade no que pode sair pela rede.
 *
 * Existe para que seja impossível esquecer: a entidade tem `passwordHash`, e
 * um `return user` distraído o colocaria na resposta. Passando por aqui, o
 * que sai é uma lista fechada de campos.
 */
function toAuthenticatedUserDto(user: User): AuthenticatedUserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}
