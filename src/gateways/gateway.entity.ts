import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * "Entidade" Gateway: o formato de um gateway de pagamento dentro do sistema.
 *
 * Até a Fase 1 isto era só uma `interface` — um formato que existia apenas na
 * memória do processo. Agora é uma CLASSE anotada, e as anotações (`@Entity`,
 * `@Column`) são o "contrato" que o TypeORM lê para criar/consultar a tabela
 * `gateways`. O TypeScript enxerga tipos; o TypeORM enxerga a tabela. A mesma
 * classe serve para os dois.
 *
 * Por que `@Entity('gateways')` com nome explícito? Sem o nome, o TypeORM
 * usaria o nome da classe ("Gateway") e o Postgres guardaria a tabela entre
 * aspas, sensível a maiúsculas. Nomear em minúsculas evita SQL com aspas
 * (`SELECT ... FROM gateways` em vez de `FROM "Gateway"`).
 *
 * DECISÃO IMPORTANTE — dinheiro:
 * `feeFixed` está em CENTAVOS e é um número inteiro (coluna `int`).
 * Nunca use número decimal (float) para dinheiro: 0.1 + 0.2 no computador
 * dá 0.30000000000000004. Centavos inteiros evitam esse tipo de erro.
 */
@Entity('gateways')
export class Gateway {
  /**
   * Chave primária em texto, não no tipo `uuid` do Postgres.
   *
   * Motivo prático: com a coluna `uuid`, uma busca por id malformado (algo
   * que não é um UUID válido) faz o PRÓPRIO banco recusar a consulta — e
   * receberíamos um erro 500 no lugar do 404 esperado. Guardando como texto,
   * `findOne('id-inexistente')` simplesmente não acha nada, que é o
   * comportamento correto.
   */
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  /** Identificador técnico, ex.: "mercado_pago". */
  @Column('varchar')
  name: string;

  /** Nome exibido para humanos, ex.: "Mercado Pago". */
  @Column('varchar')
  displayName: string;

  /**
   * Taxa percentual por transação, ex.: 3.99 (% ao mês/transação).
   *
   * Aqui usei ponto flutuante (`float8`) de propósito: percentual NÃO é
   * dinheiro — ele multiplica dinheiro. O valor monetário resultante é que
   * precisa ficar em centavos inteiros, e isso é garantido no cálculo.
   */
  @Column('float8')
  feePercent: number;

  /** Taxa fixa por transação, em centavos. Ex.: 49 = R$ 0,49. */
  @Column('int')
  feeFixed: number;

  /** Taxa de aprovação observada, de 0 a 1. Ex.: 0.92 = 92%. */
  @Column('float8')
  approvalRate: number;

  /** Se false, o roteador ignora este gateway. */
  @Column('boolean', { default: true })
  active: boolean;

  /**
   * `@CreateDateColumn` / `@UpdateDateColumn` delegam o relógio ao TypeORM:
   * `createdAt` é gravado no INSERT e nunca mais tocado; `updatedAt` é
   * reescrito a cada UPDATE. Assim não dá para esquecer de atualizar a data no
   * meio de um fluxo — o banco cuida disso.
   */
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
