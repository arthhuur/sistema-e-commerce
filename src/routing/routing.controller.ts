import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RoutingService } from './routing.service.js';
import { DecideRouteDto } from './dto/decide-route.dto.js';

/**
 * Porta de entrada do motor de roteamento.
 *
 * Por que POST e não GET? Porque isso vai evoluir: hoje é só uma decisão
 * (cálculo), mas na Fase 4 vira o passo que CRIA a cobrança no gateway
 * escolhido. Um POST com corpo já dá espaço para receber método de pagamento,
 * parcelas, dados do cliente — coisas que não cabem bem numa query string.
 */
@Controller('routing')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  @Post('decide')
  // O padrão do Nest para POST é 201 Created. Aqui nada é criado, apenas
  // decidido — então 200 OK é o status honesto.
  @HttpCode(HttpStatus.OK)
  decide(@Body() dto: DecideRouteDto) {
    return this.routingService.decide(dto.amountInCents);
  }
}
