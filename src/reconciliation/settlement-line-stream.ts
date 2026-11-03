import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { SettlementLine } from './settlement-line.js';

/**
 * Converte o corpo CRU da requisição em um fluxo de linhas do extrato.
 *
 * O formato é NDJSON ("newline-delimited JSON"): um objeto JSON por linha.
 * É o formato que gateways usam para mandar extrato em volume, e é o que
 * permite processar em fluxo — cada linha pode ser lida e descartada sem
 * esperar o arquivo inteiro.
 *
 * Por que isto NÃO usa o corpo JSON normal do Nest?
 *
 * Porque o parser padrão junta o corpo TODO na memória antes de entregar
 * (e ainda corta em 100kb, o famoso HTTP 413). Aqui lemos o corpo em PEDAÇOS,
 * na medida em que o cliente envia.
 *
 * ATENÇÃO ao detalhe do `remainder`: um pedaço do corpo não respeita as
 * quebras de linha — ele pode terminar no MEIO de uma linha. Então guardamos
 * o resto incompleto e só emitimos quando a quebra chega.
 */
export async function* readSettlementLines(
  request: Request,
): AsyncGenerator<SettlementLine> {
  let remainder = '';
  let lineNumber = 0;

  for await (const chunk of request) {
    remainder += String(chunk);

    let newlineAt = remainder.indexOf('\n');
    while (newlineAt !== -1) {
      const raw = remainder.slice(0, newlineAt);
      remainder = remainder.slice(newlineAt + 1);
      lineNumber += 1;

      const line = parseLine(raw, lineNumber);
      // Linha em branco devolve `undefined` e é simplesmente ignorada.
      if (line) {
        yield line;
      }

      newlineAt = remainder.indexOf('\n');
    }
  }

  // A última linha pode chegar sem o "\n" final.
  if (remainder.trim().length > 0) {
    const line = parseLine(remainder, lineNumber + 1);
    if (line) {
      yield line;
    }
  }
}

/** Quebra e valida UMA linha. Linha vazia devolve `undefined`. */
function parseLine(raw: string, lineNumber: number): SettlementLine | undefined {
  const text = raw.trim();
  if (text.length === 0) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadRequestException(
      `Linha ${lineNumber} do extrato não é JSON válido.`,
    );
  }

  return asSettlementLine(value, lineNumber);
}

/**
 * Confere a "forma" da linha antes de deixá-la entrar no conciliador.
 *
 * Fazemos na mão (em vez de usar o DTO com class-validator) por causa do
 * volume: transformar cada linha numa instância de classe custa caro, e aqui
 * podem passar 100 mil linhas. Para o lote pequeno, o DTO continua validando.
 */
function asSettlementLine(value: unknown, lineNumber: number): SettlementLine {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException(
      `Linha ${lineNumber} do extrato deveria ser um objeto JSON.`,
    );
  }

  const candidate = value as Record<string, unknown>;
  const { externalReference, amountInCents, totalFeeInCents, netAmountInCents } =
    candidate;
  const status = candidate.status;

  const amounts = [amountInCents, totalFeeInCents, netAmountInCents];
  const hasValidShape =
    typeof externalReference === 'string' &&
    externalReference.length > 0 &&
    amounts.every((amount) => Number.isInteger(amount)) &&
    (status === 'approved' || status === 'declined');

  if (!hasValidShape) {
    throw new BadRequestException(
      `Linha ${lineNumber} do extrato tem formato inválido.`,
    );
  }

  return {
    externalReference,
    amountInCents: amountInCents as number,
    totalFeeInCents: totalFeeInCents as number,
    netAmountInCents: netAmountInCents as number,
    status,
  };
}
