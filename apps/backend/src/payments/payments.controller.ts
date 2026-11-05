import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';
import { PaginatedPaymentsDto } from './dto/paginated-payments.dto.js';
import { PAYMENT_STATUSES, Payment } from './payment.entity.js';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cria um novo pagamento',
    description:
      'Inicia o fluxo de pagamento: valida estoque no fornecedor, escolhe o melhor gateway e processa a cobrança. ' +
      'Utiliza Idempotency-Key para garantir que a mesma cobrança não ocorra duas vezes.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Chave única da transação (ex: UUID ou ID do pedido)',
    required: true,
  })
  @ApiResponse({
    status: 201,
    description: 'Pagamento criado com sucesso.',
    type: Payment,
  })
  @ApiBadRequestResponse({ description: 'Idempotency-Key ausente ou inválida.' })
  @ApiConflictResponse({
    description: 'Requisição concorrente com a mesma chave detectada.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Sem estoque no fornecedor ou erro nos dados do pedido.',
  })
  async create(
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() dto: CreatePaymentDto,
    @Res() res: Response,
  ) {
    const result = await this.paymentsService.create(idempotencyKey, dto);

    // Adicionamos um cabeçalho customizado na resposta para que o cliente saiba
    // se o dado é novo ou se foi apenas um "replay" de algo já processado.
    res.setHeader('X-Payment-Replayed', String(result.replayed));

    return res.status(result.statusCode).json(result.payment);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista os pagamentos (paginado)',
    description:
      'Histórico do livro caixa, do mais recente para o mais antigo. ' +
      'Use `page`/`limit` para navegar e `status`/`from`/`to` para filtrar. ' +
      'Datas sem hora valem o dia inteiro (ex.: `to=2026-11-05` inclui tudo até 23:59 daquele dia).',
  })
  @ApiQuery({ name: 'page', required: false, example: 1, description: 'Página (começa em 1). Padrão: 1.' })
  @ApiQuery({ name: 'limit', required: false, example: 20, description: 'Itens por página (1 a 100). Padrão: 20.' })
  @ApiQuery({ name: 'status', required: false, enum: PAYMENT_STATUSES, description: 'Filtra por status.' })
  @ApiQuery({ name: 'from', required: false, example: '2026-11-01', description: 'Início do período (ISO 8601).' })
  @ApiQuery({ name: 'to', required: false, example: '2026-11-05', description: 'Fim do período (ISO 8601).' })
  @ApiOkResponse({
    description: 'Página de pagamentos recuperada.',
    type: PaginatedPaymentsDto,
  })
  @ApiBadRequestResponse({
    description: 'Parâmetro de paginação ou filtro inválido.',
  })
  async findAll(
    @Query() query: ListPaymentsQueryDto,
  ): Promise<PaginatedPaymentsDto> {
    return this.paymentsService.findPage(query);
  }
}
