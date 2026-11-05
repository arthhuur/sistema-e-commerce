import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * O que guardamos para cada Idempotency-Key vista.
 *
 * O `state` existe por causa de um problema real de concorrência. Pense em duas
 * requisições IDÊNTICAS chegando no mesmo milissegundo (o usuário deu dois
 * cliques muito rápidos, ou o front disparou dois requests):
 *
 *   Sem "in_progress" o fluxo seria:
 *     req1 checa a chave -> não existe
 *     req2 checa a chave -> não existe   <-- as duas passaram!
 *     req1 cobra
 *     req2 cobra                          <-- COBRANÇA DUPLA
 *
 *   Com "in_progress" reservamos a chave ANTES de cobrar:
 *     req1 reserva a chave como in_progress e segue para a cobrança
 *     req2 encontra in_progress e é barrada com HTTP 409
 *
 * Por isso o estado é gravado antes do trabalho pesado, e não depois.
 *
 * AGORA O BANCO GARANTE ISSO: na Fase 1 a reserva era um `Map` no processo —
 * dois servidores (ou dois processos) teriam dois mapas e a proteção valeria
 * nada. Com a chave sendo CHAVE PRIMÁRIA da tabela, é o Postgres que impede
 * duas reservas da mesma chave, mesmo com vários servidores rodando.
 */
export type IdempotencyState = 'in_progress' | 'completed';

@Entity('idempotency_records')
export class IdempotencyRecord {
  /**
   * A própria Idempotency-Key é a chave primária.
   *
   * Não é detalhe estético: é a restrição de unicidade do banco que
   * transforma "ler, decidir, gravar" em uma operação segura sob concorrência.
   * Duas gravações simultâneas da mesma chave: uma vence, a outra recebe erro
   * de violação de unicidade — e nós a tratamos como "já em andamento".
   */
  @PrimaryColumn('varchar', { length: 255 })
  key: string;

  /**
   * "Impressão digital" do corpo da requisição (hash SHA-256).
   * Serve para detectar quando o cliente reutiliza a MESMA chave com um corpo
   * DIFERENTE — cenário perigoso, porque devolver a resposta antiga faria o
   * cliente acreditar que cobrou R$ 100 quando ele pediu R$ 200.
   */
  @Column('varchar', { length: 64 })
  requestFingerprint: string;

  @Column('varchar', { length: 20 })
  state: IdempotencyState;

  @CreateDateColumn()
  createdAt: Date;

  /**
   * Corpo da resposta, guardado para o replay. Só existe quando completed.
   *
   * Coluna `jsonb`: o Postgres guarda o objeto JSON de forma estruturada
   * (e não como texto), então ele volta do banco já como objeto — pronto para
   * ser devolvido ao cliente, sem `JSON.parse` na mão.
   */
  @Column({ type: 'jsonb', nullable: true })
  response?: unknown;

  /** Status HTTP original, para o replay devolver exatamente o mesmo. */
  @Column({ type: 'int', nullable: true })
  statusCode?: number;
}
