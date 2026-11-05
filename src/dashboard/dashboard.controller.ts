import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardSummaryDto } from './dashboard-summary.dto.js';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto.js';

/**
 * O resumo numérico da operação.
 *
 * ESTA ROTA TEM `@Roles(...)` — e a listagem de gateways não tem. A diferença
 * é intencional.
 *
 * O critério do projeto é: restringe-se o que EXPÕE ou o que ESCREVE. Aqui
 * saem faturamento, líquido e taxas — os números do negócio. O roadmap diz
 * explicitamente que o perfil "estoque" não pode ver taxas nem lucro. Deixar a
 * rota aberta a qualquer sessão entregaria isso de bandeja.
 *
 * E é o `RolesGuard` que garante: esconder o cartão no front não é proteção.
 */
@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @Roles('gerente', 'financeiro')
  @ApiOperation({
    summary: 'Resumo da operação (dashboard)',
    description:
      'Números agregados do período: total processado, quantidade, ticket médio, líquido e taxas. ' +
      'Sem parâmetros, considera HOJE. Restrito aos perfis gerente e financeiro.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01', description: 'Início do período (ISO 8601). Padrão: hoje.' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-05', description: 'Fim do período (ISO 8601). Padrão: hoje.' })
  @ApiOkResponse({ description: 'Resumo do período.', type: DashboardSummaryDto })
  @ApiForbiddenResponse({
    description: 'O perfil do usuário não tem acesso aos números financeiros.',
  })
  summarize(@Query() query: DashboardSummaryQueryDto): Promise<DashboardSummaryDto> {
    return this.dashboardService.summarize(query);
  }
}
