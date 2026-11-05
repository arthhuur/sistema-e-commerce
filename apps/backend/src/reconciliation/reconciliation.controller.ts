import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReconciliationService } from './reconciliation.service.js';
import { RunReconciliationDto } from './dto/run-reconciliation.dto.js';
import { readSettlementLines } from './settlement-line-stream.js';

/**
 * O "garçom" da conciliação.
 *
 * Detalhe: usamos @HttpCode(200) em vez do 201 padrão do @Post().
 * Motivo: este endpoint NÃO cria recurso nenhum — ele ANALISA. O verbo POST
 * é usado só porque mandamos uma lista no corpo (que não caberia bem numa
 * query string). Devolver 201 "Created" aqui seria mentira.
 */
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
  ) {}

  /**
   * POST /reconciliation/run
   * Corpo: { "lines": [ { externalReference, amountInCents, totalFeeInCents,
   *                       netAmountInCents, status }, ... ] }
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@Body() dto: RunReconciliationDto) {
    return this.reconciliationService.reconcile(dto.lines);
  }

  /**
   * POST /reconciliation/run/stream
   *
   * A porta de entrada para extrato GRANDE. Em vez de um JSON com a lista
   * inteira (que o parser corta em 100kb), o corpo é NDJSON: uma linha do
   * extrato por linha do corpo.
   *
   * Duas diferenças que fazem a escala acontecer:
   *  1. Não há limite de tamanho — lemos o corpo em pedaços.
   *  2. A memória não cresce com o arquivo — cada linha é processada e
   *     descartada.
   *
   * Repare no `@Req()` no lugar de `@Body()`: este endpoint precisa do corpo
   * CRU, e não do objeto já montado pelo parser do Express.
   */
  @Post('run/stream')
  @HttpCode(HttpStatus.OK)
  runStream(@Req() request: Request) {
    return this.reconciliationService.reconcileStream(
      readSettlementLines(request),
    );
  }
}
