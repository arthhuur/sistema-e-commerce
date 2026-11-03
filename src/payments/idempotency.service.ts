import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.js';

/**
 * Resultado da tentativa de "começar" uma operação idempotente.
 *
 * - `replayed: false` -> é a primeira vez com esta chave; pode processar.
 * - `replayed: true`  -> já processamos antes; devolva a resposta guardada
 *                        (`statusCode` + `response`) e NÃO cobre de novo.
 */
export interface BeginResult {
  replayed: boolean;
  statusCode?: number;
  response?: unknown;
}

/**
 * O "caderno de etiquetas" da idempotência.
 *
 * Responsabilidade ÚNICA: saber se uma Idempotency-Key já foi vista e o que
 * respondemos naquela ocasião. Ele NÃO sabe nada sobre pagamentos, roteamento
 * ou taxas — e é justamente por isso que dá para testá-lo sozinho.
 *
 * O QUE MUDOU NA FASE 2 — o caderno virou TABELA.
 * Antes era um `Map` no processo, e a proteção contra cobrança dupla valia
 * só dentro de UM servidor. Agora a chave é a chave primária da tabela
 * `idempotency_records`: é o BANCO que garante a unicidade, então a garantia
 * vale para o sistema todo, com quantos servidores você quiser.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly records: Repository<IdempotencyRecord>,
  ) {}

  /**
   * Tenta reservar a chave.
   *
   * Lança exceção quando a chave é inválida para continuar; devolve
   * `replayed: true` quando já temos uma resposta pronta para reaproveitar.
   */
  async begin(key: string, payload: unknown): Promise<BeginResult> {
    const requestFingerprint = this.fingerprint(payload);
    let existing = await this.records.findOne({ where: { key } });

    // Caso 1 — primeira vez que vemos esta chave. RESERVAMOS AGORA.
    if (!existing) {
      try {
        await this.records.insert({
          key,
          requestFingerprint,
          state: 'in_progress',
        });
        return { replayed: false };
      } catch (error) {
        // CORRIDA REAL: entre o `findOne` acima e este `insert`, outra
        // requisição (em outro servidor, em outro processo) pode ter inserido
        // a MESMA chave. O `Map` da Fase 1 não tinha como detectar isso; a
        // chave primária do banco detecta: uma das duas gravações recebe
        // violação de unicidade. Nesse caso, relemos e tratamos como
        // "já existe" — que é exatamente o que o Caso 3 abaixo faz.
        if (!this.isUniqueViolation(error)) {
          throw error;
        }

        existing = await this.records.findOne({ where: { key } });
        // Se nem depois do erro a linha existe, o problema não é concorrência
        // e sim algo que não sabemos explicar. Melhor estourar do que seguir.
        if (!existing) {
          throw error;
        }
      }
    }

    return this.interpret(existing, requestFingerprint);
  }

  /** Marca a chave como concluída e guarda a resposta para futuros replays. */
  async complete(
    key: string,
    response: unknown,
    statusCode: number,
    /**
     * `manager` opcional: permite gravar dentro de uma TRANSAÇÃO já aberta.
     *
     * É isso que deixa "gravar o pagamento" e "marcar a chave como usada"
     * acontecerem de forma atômica lá no PaymentsService. Sem o parâmetro,
     * a operação usa a conexão normal do repositório.
     */
    manager?: EntityManager,
  ): Promise<void> {
    const runner = manager ?? this.records.manager;

    const result = await runner.update(
      IdempotencyRecord,
      { key },
      {
        state: 'completed',
        response: response as object,
        statusCode,
      },
    );

    // Se chegamos aqui sem afetar linha nenhuma, é bug de programação:
    // `complete` deve ser sempre precedido por um `begin` bem-sucedido.
    // Falhar alto é melhor do que gravar um estado inconsistente em silêncio.
    if (!result.affected) {
      throw new Error(
        `complete() chamado sem begin() para a chave ${key}. Isso é um bug.`,
      );
    }
  }

  /**
   * Libera a reserva quando o processamento FALHA.
   *
   * Sem isso, uma falha deixaria a chave presa em "in_progress" para sempre, e
   * o cliente nunca conseguiria reprocessar aquele pagamento. Soltar a chave
   * na falha é o que torna a retentativa possível.
   */
  async release(key: string): Promise<void> {
    await this.records.delete({ key });
  }

  /**
   * Traduz um registro JÁ EXISTENTE em decisão: recusar, esperar ou replicar.
   *
   * Extraído para método próprio porque o `begin` precisa dele em dois
   * momentos: quando acha a linha na leitura e quando perde a corrida do
   * INSERT. Escrever essa regra duas vezes seria pedir para as cópias
   * divergirem na primeira correção.
   */
  private interpret(
    existing: IdempotencyRecord,
    requestFingerprint: string,
  ): BeginResult {
    // Mesma chave, corpo diferente: reuso indevido da chave.
    // HTTP 422 (Unprocessable Entity): o corpo é válido, mas o significado
    // dentro deste contexto (chave já usada) não faz sentido.
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new UnprocessableEntityException(
        'Esta Idempotency-Key já foi usada com um corpo diferente.',
      );
    }

    // A requisição anterior ainda está sendo processada.
    // HTTP 409 (Conflict): "espere, isso já está em andamento".
    if (existing.state === 'in_progress') {
      throw new ConflictException(
        'Já existe uma requisição em andamento com esta Idempotency-Key.',
      );
    }

    // Já concluída: é exatamente isto que o cliente quer. Replay.
    return {
      replayed: true,
      statusCode: existing.statusCode,
      response: existing.response,
    };
  }

  /**
   * O erro é "violação de chave única" do Postgres?
   *
   * O código `23505` é o `unique_violation` do Postgres. O driver `pg` o
   * coloca em `driverError.code`; o TypeORM só embrulha o erro original em
   * `QueryFailedError`. Ler esse código é o jeito confiável de distinguir
   * "perdi a corrida" de "o banco caiu" — comparar texto de mensagem
   * quebraria no dia em que o idioma ou a versão mudasse.
   */
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string } | undefined;
    return driverError?.code === '23505';
  }

  /**
   * Hash SHA-256 do corpo, para comparar requisições sem guardar o corpo todo.
   *
   * Por que hash e não o corpo cru? Dois motivos:
   *  1. Privacidade: o hash não revela o conteúdo.
   *  2. Tamanho: 64 caracteres fixos, não importa o tamanho da requisição.
   * Como SHA-256 é determinístico, o mesmo corpo gera sempre o mesmo hash — e
   * corpos diferentes geram hashes diferentes (na prática, sempre).
   */
  private fingerprint(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
