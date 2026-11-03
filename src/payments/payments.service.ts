import {
  BadRequestException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { RoutingService } from '../routing/routing.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { SuppliersService } from './suppliers.service.js';
import { Payment } from './payment.entity.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';

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
   */
  async findAll(): Promise<Payment[]> {
    return this.payments.find();
  }
}
