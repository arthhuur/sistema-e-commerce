import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { Payment } from './payment.entity.js';

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
    summary: 'Lista todos os pagamentos',
    description: 'Retorna o histórico completo do livro caixa.',
  })
  @ApiOkResponse({
    description: 'Lista de pagamentos recuperada.',
    type: [Payment],
  })
  async findAll(): Promise<Payment[]> {
    return this.paymentsService.findAll();
  }
}
