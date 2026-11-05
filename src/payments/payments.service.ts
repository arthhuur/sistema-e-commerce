import {
  BadRequestException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import {
  Between,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { RoutingService } from '../routing/routing.service.js';
import { parseDateRange } from '../common/date-range.js';
import { IdempotencyService } from './idempotency.service.js';
import { SuppliersService } from './suppliers.service.js';
import { Payment } from './payment.entity.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto.js';

/**
 * O que o Controller precisa para responder: o status, se foi replay e o corpo.
 *
 * Devolvemos um objeto em vez de o Service mexer em `res.status()` porque
 * queremos que o Service continue ignorando HTTP. O Controller traduz.
 */
export interface PaymentCreationResult {
  statusCode: number;
  /** true = resposta reaproveitada; nada foi cobrado nesta chamada. */
  replayed: boolean;
  payment: Payment;
}

/**
 * Uma página do livro caixa.
 *
 * `total` é a contagem de TUDO que casou com o filtro — não o tamanho de
 * `data`. É a diferença entre "20 registros" e "20 registros de 143": sem o
 * total, o front não tem como desenhar a navegação.
 */
export interface PaymentPage {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
}

/**
 * A "cozinha" dos pagamentos: cria a cobrança, escolhendo o gateway pelo motor
 * de roteamento, e garante que uma mesma Idempotency-Key só cobre UMA vez.
 *
 * Este Service depende de dois outros. Repare que ele não sabe COMO o gateway é
 * escolhido nem COMO a chave é guardada — ele apenas usa os dois serviços.
 * Isso é o "S" de SOLID: cada peça com uma responsabilidade.
 */
@Injectable()
export class PaymentsService {
  /**
   * O "livro caixa": todo pagamento criado fica aqui.
   *
   * O QUE MUDOU NA FASE 2 — o `Map` virou `Repository`.
   * Antes o livro caixa vivia só na memória do processo: sumia no restart e
   * dois servidores teriam dois livros caixa diferentes. Agora ele é a tabela
   * `payments`, e este Service passou a ser quem PEDE ao banco em vez de quem
   * guarda. A conciliação continua precisando do mesmo: uma lista do que NÓS
   * registramos, para comparar com o extrato do gateway.
   *
   * Todos os métodos ficaram ASSÍNCRONOS pelo mesmo motivo do GatewaysService:
   * falar com o banco é esperar rede e disco.
   */
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
    private readonly routingService: RoutingService,
    private readonly idempotencyService: IdempotencyService,
    private readonly suppliersService: SuppliersService,
  ) {}

  async create(
    idempotencyKey: string | undefined,
    dto: CreatePaymentDto,
  ): Promise<PaymentCreationResult> {
    // Sem a etiqueta não há como garantir "cobrar uma vez só". Recusar é mais
    // seguro do que aceitar e arriscar cobrança dupla depois.
    if (!idempotencyKey) {
      throw new BadRequestException(
        'O cabeçalho Idempotency-Key é obrigatório.',
      );
    }

    // Resolvemos o valor final ANTES de gerar a impressão digital.
    // Se usássemos `dto.currency` cru, mandar "BRL" e omitir a moeda gerariam
    // impressões diferentes para o MESMO pedido — e o replay falharia.
    const currency = dto.currency ?? 'BRL';

    const begin = await this.idempotencyService.begin(idempotencyKey, {
      amountInCents: dto.amountInCents,
      currency,
    });

    // Já vimos esta chave antes e terminamos: devolvemos a MESMA resposta.
    // O corpo volta do `jsonb` já como objeto — é o pagamento que gravamos.
    if (begin.replayed) {
      return {
        statusCode: begin.statusCode ?? HttpStatus.CREATED,
        replayed: true,
        payment: begin.response as Payment,
      };
    }

    // Daqui para baixo é a primeira vez com esta chave. A reserva já foi
    // feita, então uma segunda requisição concorrente será barrada com 409.
    let completed = false;
    try {
      // REGRA DE NEGÓCIO (Dropshipping): validar estoque antes de cobrar.
      // Se não houver estoque no fornecedor, não faz sentido processar o pagamento.
      const hasStock = await this.suppliersService.checkStock(dto.productId);
      if (!hasStock) {
        throw new UnprocessableEntityException(
          `Produto ${dto.productId} sem estoque disponível no fornecedor.`,
        );
      }

      const decision = await this.routingService.decide(dto.amountInCents);

      // Sem gateway ativo não inventamos cobrança. 503 = "tente mais tarde",
      // que é a resposta honesta: o serviço existe, mas está indisponível.
      if (!decision.chosen) {
        throw new ServiceUnavailableException(decision.reason);
      }

      const payment = this.payments.create({
        id: randomUUID(),
        amountInCents: dto.amountInCents,
        currency,
        productId: dto.productId,
        gatewayId: decision.chosen.gatewayId,
        gatewayName: decision.chosen.gatewayName,
        netAmountInCents: decision.chosen.netAmountInCents,
        totalFeeInCents: decision.chosen.totalFeeInCents,
        // SIMULADO por enquanto: ainda não fazemos a chamada HTTP real ao
        // gateway. Quando fizermos (Fase 2), este status passa a vir da
        // resposta do gateway, e o desfecho "recusado" entra no fluxo.
        status: 'approved',
      });

      // TRANSAÇÃO: gravar o pagamento e marcar a chave como concluída
      // acontecem juntos, ou não acontecem.
      //
      // Na Fase 1 a garantia vinha da ORDEM das duas linhas ("grave depois de
      // concluir"). Sozinha, a ordem não protege contra uma queda no meio do
      // caminho: se o processo morresse entre uma linha e outra, sobraria um
      // pagamento no livro caixa sem a chave marcada — e a retentativa criaria
      // um segundo pagamento. A transação elimina esse estado intermediário:
      // ou as duas gravações valem, ou nenhuma vale.
      await this.payments.manager.transaction(async (manager) => {
        // `save` na MESMA instância: o TypeORM preenche o `createdAt` nela, e
        // é esse objeto já completo que guardamos na resposta da idempotência.
        await manager.save(payment);
        await this.idempotencyService.complete(
          idempotencyKey,
          payment,
          HttpStatus.CREATED,
          manager,
        );
      });
      completed = true;

      return { statusCode: HttpStatus.CREATED, replayed: false, payment };
    } finally {
      // Se qualquer coisa der errado antes de concluir, liberamos a reserva.
      // Sem isto a chave ficaria presa em "in_progress" e o lojista não
      // conseguiria retentar. O `finally` roda tanto no sucesso quanto na
      // exceção — mas só liberamos quando NÃO concluímos, para não apagar um
      // resultado já gravado.
      if (!completed) {
        await this.idempotencyService.release(idempotencyKey);
      }
    }
  }

  /**
   * Lista o livro caixa. É o "nosso lado" da conciliação.
   *
   * ATENÇÃO: este método devolve TUDO, sem paginação — de propósito. Quem o
   * consome é a conciliação, que precisa comparar o nosso extrato inteiro com
   * o do gateway. Paginar aqui quebraria essa comparação (as linhas que
   * sobrassem apareceriam como "cobrança fantasma"). Quem serve a TELA é o
   * `findPage()` abaixo.
   */
  async findAll(): Promise<Payment[]> {
    return this.payments.find();
  }

  /**
   * Lista paginada, com filtro por status e período. É o que a tela consome.
   *
   * POR QUE UM MÉTODO NOVO EM VEZ DE MUDAR O `findAll()`.
   *
   * `findAll()` tem outro consumidor — a conciliação — que depende de receber
   * TODAS as linhas. Se a paginação tivesse sido colocada lá, a conciliação
   * passaria a comparar só os 20 primeiros pagamentos e a classificação dos
   * outros 99.980 como "não liquidado" seria silenciosa: verde no teste, errado
   * na operação. Dois públicos diferentes pedem dois métodos.
   */
  async findPage(query: ListPaymentsQueryDto): Promise<PaymentPage> {
    // Os padrões são aplicados AQUI, no servidor, e não no DTO: assim a
    // resposta sempre diz qual página e qual tamanho foram realmente usados.
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<Payment> = {};

    if (query.status) {
      where.status = query.status;
    }

    // `parseDateRange` transforma "2026-11-05" no DIA INTEIRO (00:00 até
    // 23:59:59.999). Sem isso, quem pedisse `to=2026-11-05` perderia as
    // vendas daquele mesmo dia.
    const { from, to } = parseDateRange(query.from, query.to);

    if (from && to) {
      where.createdAt = Between(from, to);
    } else if (from) {
      where.createdAt = MoreThanOrEqual(from);
    } else if (to) {
      where.createdAt = LessThanOrEqual(to);
    }

    const [data, total] = await this.payments.findAndCount({
      where,
      // Do mais recente para o mais antigo: é a ordem que a tela espera.
      //
      // O `id` entra como critério de desempate e NÃO é detalhe: quando muitas
      // linhas são gravadas no mesmo instante (importação em lote, por
      // exemplo), elas têm exatamente o mesmo `createdAt`. Sem um segundo
      // critério a ordem fica indefinida, e aí a MESMA linha pode aparecer em
      // duas páginas — ou sumir de todas.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // `total` é a contagem de TUDO que casou com o filtro, não só da página.
    // É esse número que permite ao front desenhar "página 1 de 40".
    return { data, total, page, limit };
  }
}
