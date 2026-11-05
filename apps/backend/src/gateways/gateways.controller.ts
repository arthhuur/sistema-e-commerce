import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GatewaysService } from './gateways.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateGatewayDto } from './dto/create-gateway.dto.js';
import { UpdateGatewayDto } from './dto/update-gateway.dto.js';
import { ListGatewaysQueryDto } from './dto/list-gateways-query.dto.js';
import { EstimateFeeQueryDto } from './dto/estimate-fee-query.dto.js';
import { Gateway } from './gateway.entity.js';

/**
 * Repare QUAIS rotas ganharam `@Roles(...)`: as que ESCREVEM.
 *
 * Mexer em gateway é mexer em por onde o dinheiro entra. Quem decide isso é o
 * gerente. Já ler a lista de gateways não muda nada para ninguém — quem está
 * logado e precisa conferir uma taxa pode consultar.
 *
 * A distinção não é preciosismo: aplicar perfil em tudo travaria operações
 * legítimas (o vendedor precisa ver as taxas para explicar o valor ao
 * cliente), e não aplicar em nada deixaria qualquer pessoa trocar o gateway
 * da loja.
 */
@ApiTags('Gateways')
@Controller('gateways')
export class GatewaysController {
  constructor(private readonly gatewaysService: GatewaysService) {}

  @Post()
  @Roles('gerente')
  @ApiOperation({ summary: 'Cadastra um novo gateway de pagamento' })
  @ApiOkResponse({ type: Gateway })
  create(@Body() dto: CreateGatewayDto) {
    return this.gatewaysService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista os gateways cadastrados' })
  @ApiOkResponse({ type: [Gateway] })
  findAll(@Query() query: ListGatewaysQueryDto) {
    return this.gatewaysService.findAll(query);
  }

  @Get(':id/estimate')
  @ApiOperation({
    summary: 'Estima taxas para um valor específico',
    description:
      'Calcula quanto este gateway cobraria (taxa fixa + variável) para o valor informado.',
  })
  estimate(@Param('id') id: string, @Query() query: EstimateFeeQueryDto) {
    return this.gatewaysService.estimateFee(id, query.amountInCents);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca detalhes de um gateway pelo ID' })
  @ApiOkResponse({ type: Gateway })
  findOne(@Param('id') id: string) {
    return this.gatewaysService.findOne(id);
  }

  @Patch(':id')
  @Roles('gerente')
  @ApiOperation({ summary: 'Atualiza dados de um gateway' })
  @ApiOkResponse({ type: Gateway })
  update(@Param('id') id: string, @Body() dto: UpdateGatewayDto) {
    return this.gatewaysService.update(id, dto);
  }

  @Delete(':id')
  @Roles('gerente')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove um gateway do sistema' })
  @ApiNoContentResponse({ description: 'Gateway removido com sucesso.' })
  remove(@Param('id') id: string) {
    return this.gatewaysService.remove(id);
  }
}
