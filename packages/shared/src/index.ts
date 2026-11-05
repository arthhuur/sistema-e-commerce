/**
 * O contrato da API, num lugar só.
 *
 * POR QUE ESTE PACOTE EXISTE.
 *
 * A API é escrita em NestJS e a interface em Next.js — dois projetos, dois
 * `tsconfig`, duas linguagens na prática. O jeito fácil é o front reescrever
 * os tipos "a olho", copiando o JSON que a API devolve. Enquanto ninguém
 * mexer, funciona. No dia em que a API renomear um campo, o front continua
 * compilando, os testes continuam verdes, e o bug aparece na tela do cliente:
 * um campo vazio, silencioso.
 *
 * Aqui os dois lados leem a MESMA declaração. Se a API mudar, o front para de
 * compilar — que é o erro que a gente QUER, e cedo.
 *
 * REGRA DESTE ARQUIVO.
 *
 * Ele descreve o que sai pela rede (o JSON), não a entidade do banco. Por isso
 * os nomes de campo são os que aparecem na resposta, e não os da tabela.
 *
 * A duplicação que ainda existe é consciente: o backend, hoje, declara esses
 * formatos nos próprios DTOs do Swagger. Este pacote passa a ser a fonte da
 * verdade, e o backend adota aos poucos, à medida que cada DTO for tocado —
 * uma refatoração de uma vez só mexeria em migrations e no contrato público
 * sem necessidade.
 */

/**
 * Os perfis de acesso, na mesma ordem do backend (do mais poderoso para o
 * mais restrito).
 *
 * É uma LISTA, e não só um tipo, porque a tela precisa do conjunto em tempo
 * de execução: para montar um menu, validar um formulário ou escrever um
 * rótulo legível. Um `type` sozinho desaparece depois da compilação.
 */
export const USER_ROLES = ['gerente', 'financeiro', 'vendedor', 'estoque'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Rótulos em português para exibir o perfil sem jargão na tela. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  gerente: 'Gerente',
  financeiro: 'Financeiro',
  vendedor: 'Vendedor',
  estoque: 'Estoque',
};

/**
 * Os status possíveis de um pagamento.
 *
 * Hoje só existe `approved`: a cobrança ainda é simulada, então todo registro
 * nasce e morre aprovado. O status "recusado" entra quando a chamada ao
 * gateway virar real (Fase 2).
 */
export const PAYMENT_STATUSES = ['approved'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Quem está logado.
 *
 * É o que `POST /auth/login` (quando não há segundo fator) e `GET /auth/me`
 * devolvem. Repare no que NÃO está aqui: o token. Ele viaja só como cookie
 * `httpOnly`, invisível para o JavaScript da página.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * A resposta de `POST /auth/login` quando a conta tem segundo fator ativo.
 *
 * Neste caso a sessão NÃO abriu: a API só gravou um cookie temporário. O front
 * precisa distinguir os dois desfechos do login por este campo — um `200` sem
 * `email` seria ambíguo sem ele.
 */
export interface MfaChallenge {
  mfaRequired: true;
}

/** Situação do segundo fator de uma conta. */
export interface MfaStatus {
  /** O login já exige o código do aplicativo. */
  enabled: boolean;
  /** A configuração começou (o QR foi gerado) mas ainda não foi confirmada. */
  pending: boolean;
}

/** O que `POST /auth/mfa/setup` devolve para configurar o aplicativo. */
export interface MfaSetupResponse {
  /** URL `otpauth://` que o autenticador entende. */
  otpauthUrl: string;
  /** O mesmo conteúdo em QR Code, pronto para um `<img src>`. */
  qrDataUrl: string;
}

/** Os códigos de recuperação — mostrados uma única vez. */
export interface MfaRecoveryCodesResponse {
  recoveryCodes: string[];
}

/**
 * Um pagamento já processado.
 *
 * `createdAt` é `string` de propósito: apesar de a entidade guardar um `Date`,
 * o que trafega no JSON é texto ISO 8601. Tipar como `Date` aqui daria a
 * falsa impressão de que um `.getTime()` funcionaria — e ele não existe no
 * objeto que o `fetch` entrega.
 */
export interface Payment {
  id: string;
  /** Valor cobrado do cliente, em centavos (inteiro — nunca float). */
  amountInCents: number;
  currency: string;
  productId: string;
  gatewayId: string;
  gatewayName: string;
  /** Quanto sobrou para o lojista, em centavos. */
  netAmountInCents: number;
  /** Total de taxas pagas ao gateway, em centavos. */
  totalFeeInCents: number;
  status: PaymentStatus;
  /** Instante de criação do registro, em ISO 8601. */
  createdAt: string;
}

/**
 * Um gateway de pagamento cadastrado.
 *
 * NOME E RÓTULO SÃO COISAS DIFERENTES, e o contrato carrega os dois: `name` é
 * o identificador técnico (ex.: "mercado_pago"), usado em código e em log;
 * `displayName` é o que aparece na tela (ex.: "Mercado Pago"). Separá-los evita
 * que renomear o rótulo na interface quebre qualquer integração que dependa do
 * identificador.
 *
 * A MESMA REGRA DE DINHEIRO DO RESTO DO CONTRATO: o que é dinheiro vem em
 * CENTAVOS inteiros (`feeFixed`). Já `feePercent` e `approvalRate` são
 * PROPORÇÕES, e proporção não é dinheiro — por isso são decimais, de propósito.
 */
export interface Gateway {
  id: string;
  /** Identificador técnico, ex.: "mercado_pago". */
  name: string;
  /** Nome exibido para humanos, ex.: "Mercado Pago". */
  displayName: string;
  /** Taxa percentual por transação, de 0 a 100 (ex.: 3.99 = 3,99%). */
  feePercent: number;
  /** Taxa fixa por transação, em centavos (ex.: 49 = R$ 0,49). */
  feeFixed: number;
  /** Taxa de aprovação observada, de 0 a 1 (ex.: 0.92 = 92%). */
  approvalRate: number;
  /** Se false, o roteador ignora este gateway. */
  active: boolean;
  /** Criação e última alteração do registro, em ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Quanto custaria passar uma transação por um gateway.
 *
 * É a resposta de `GET /gateways/:id/estimate` — e a peça que o motor de
 * roteamento usa para escolher o gateway mais barato. Tudo em centavos: a
 * estimativa chega SOMADA e ARREDONDADA do servidor, e a tela só formata.
 * Refazer a conta aqui daria um número que o servidor não confirma.
 */
export interface GatewayFeeEstimate {
  gatewayId: string;
  gatewayName: string;
  /** Valor da transação simulada, em centavos. */
  amountInCents: number;
  /** Parte fixa da taxa, em centavos. */
  feeFixedInCents: number;
  /** Parte percentual da taxa, já arredondada, em centavos. */
  feePercentInCents: number;
  /** Taxa total cobrada pelo gateway, em centavos. */
  totalFeeInCents: number;
  /** O que sobra para o lojista depois da taxa, em centavos. */
  netAmountInCents: number;
}

/**
 * O envelope de qualquer listagem paginada.
 *
 * `total` é a contagem REAL do que casou com o filtro (não só o tamanho da
 * página). Sem ele, a tela não consegue desenhar "página 1 de 40".
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * O resumo numérico do dashboard.
 *
 * Todos os valores monetários estão em CENTAVOS. A formatação para reais é
 * responsabilidade de quem exibe a tela, não do contrato.
 */
export interface DashboardSummary {
  /** Início do período considerado, em ISO 8601. */
  periodStart: string;
  /** Fim do período considerado, em ISO 8601. */
  periodEnd: string;
  /** Quantidade de pagamentos aprovados no período. */
  paymentCount: number;
  /** Soma do valor cobrado dos clientes, em centavos. */
  totalProcessedInCents: number;
  /** Ticket médio do período, em centavos (arredondado). */
  averageTicketInCents: number;
  /** Quanto sobrou para o lojista depois das taxas, em centavos. */
  netReceivedInCents: number;
  /** Total pago em taxas aos gateways, em centavos. */
  totalFeesInCents: number;
}
