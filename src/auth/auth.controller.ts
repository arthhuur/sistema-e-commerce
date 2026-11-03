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
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import type { SessionResult } from './auth.service.js';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
  sessionCookieOptions,
} from './auth.constants.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto.js';
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
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica e abre a sessão',
    description:
      'Confere e-mail e senha e grava dois cookies httpOnly: o de acesso (15 min) e o de renovação (7 dias). ' +
      'Em caso de falha, a mensagem é sempre a mesma, para não revelar se o e-mail existe.',
  })
  @ApiOkResponse({ description: 'Sessão aberta.', type: AuthenticatedUserDto })
  @ApiUnauthorizedResponse({ description: 'E-mail ou senha incorretos.' })
  @ApiTooManyRequestsResponse({
    description: 'Tentativas demais em pouco tempo.',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUserDto> {
    const session = await this.authService.login(dto);
    this.writeSessionCookies(res, session);

    return toAuthenticatedUserDto(session.user);
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
