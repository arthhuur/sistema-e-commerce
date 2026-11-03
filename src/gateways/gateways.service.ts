import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Gateway } from './gateway.entity.js';
import { CreateGatewayDto } from './dto/create-gateway.dto.js';
import { UpdateGatewayDto } from './dto/update-gateway.dto.js';
import { ListGatewaysQueryDto } from './dto/list-gateways-query.dto.js';
import { FeeEstimate } from './fee-estimate.js';

/**
 * A "cozinha": aqui vive a regra de negócio dos gateways.
 *
 * Repare que NÃO existe nada de HTTP neste arquivo: nenhuma menção a request,
 * response ou status code. Isso é de propósito — significa que podemos testar
 * essa classe sem subir servidor.
 *
 * O QUE MUDOU NA FASE 2 — o `Map` virou `Repository`.
 * `@InjectRepository(Gateway)` pede ao Nest o "balcão de atendimento" desta
 * tabela. O Service deixou de ser o DONO do dado (não guarda mais nada) e
 * passou a ser quem PEDE ao banco. O ganho: o dado sobrevive a reinícios e
 * vários servidores enxergam a mesma coisa.
 *
 * O CUSTO: toda operação de banco é ASSÍNCRONA — espera de rede, de disco.
 * Por isso todos os métodos agora devolvem `Promise`. Essa mudança se espalha
 * para quem chama (RoutingService, Controller), e é normal: é a assincronia
 * do banco vazando para as camadas de cima, uma vez só.
 */
@Injectable()
export class GatewaysService {
  constructor(
    @InjectRepository(Gateway)
    private readonly gateways: Repository<Gateway>,
  ) {}

  async create(dto: CreateGatewayDto): Promise<Gateway> {
    // `create()` do repositório só MONTA a entidade em memória (sem id, sem
    // gravar nada). `save()` é que faz o INSERT. Separar os dois permite
    // validar/ajustar o objeto antes de ir ao banco.
    const gateway = this.gateways.create({
      id: randomUUID(),
      name: dto.name,
      displayName: dto.displayName,
      feePercent: dto.feePercent,
      feeFixed: dto.feeFixed,
      approvalRate: dto.approvalRate,
      // Se o cliente não mandar "active", assumimos que o gateway começa ativo.
      active: dto.active ?? true,
    });

    // `save` devolve a entidade como ela FICOU no banco — já com `createdAt` /
    // `updatedAt` preenchidos pelas colunas de data. Por isso devolvemos o
    // retorno do save, e não o objeto que montamos.
    return this.gateways.save(gateway);
  }

  async findAll(filter?: ListGatewaysQueryDto): Promise<Gateway[]> {
    // Se o cliente não informou "active", não filtramos: devolvemos tudo.
    // `find()` sem `where` equivale a `SELECT * FROM gateways`.
    if (filter?.active === undefined) {
      return this.gateways.find();
    }

    // AGORA O FILTRO É SQL, não um `filter()` do JavaScript: quem separa os
    // ativos é o Postgres, que só traz da rede o que interessa.
    // Comparação estrita com boolean de verdade — o DTO já garantiu isso.
    return this.gateways.find({ where: { active: filter.active } });
  }

  /**
   * Busca por id. Se não existir, lança NotFoundException.
   * O Nest intercepta essa exceção e devolve automaticamente um HTTP 404.
   * Isso é "throw, don't return error codes": o Service fala a língua do
   * domínio, não a língua do HTTP.
   *
   * Note o `| null` no retorno do driver: o banco responde "nada" (null) e
   * SOMOS NÓS que traduzimos isso para a exceção. Traduzir o "não achou" do
   * banco para o "não encontrado" da API é trabalho do Service.
   */
  async findOne(id: string): Promise<Gateway> {
    const gateway = await this.gateways.findOne({ where: { id } });
    if (!gateway) {
      throw new NotFoundException(`Gateway ${id} não encontrado`);
    }
    return gateway;
  }

  async update(id: string, dto: UpdateGatewayDto): Promise<Gateway> {
    const current = await this.findOne(id);

    // ATENÇÃO — armadilha clássica do NestJS:
    // `{ ...current, ...dto }` parece inofensivo, mas o ValidationPipe cria a
    // instância do DTO com TODAS as propriedades declaradas na classe. As que
    // não vieram no corpo do PATCH ficam com valor `undefined` e, ao espalhar,
    // sobrescrevem os valores válidos por undefined (e o JSON.stringify some
    // com as chaves). Por isso atribuímos campo a campo com `??`, que só
    // substitui quando o valor realmente veio.
    current.name = dto.name ?? current.name;
    current.displayName = dto.displayName ?? current.displayName;
    current.feePercent = dto.feePercent ?? current.feePercent;
    current.feeFixed = dto.feeFixed ?? current.feeFixed;
    current.approvalRate = dto.approvalRate ?? current.approvalRate;
    current.active = dto.active ?? current.active;

    // `save` numa entidade que JÁ TEM id vira UPDATE (e o `@UpdateDateColumn`
    // grava o `updatedAt` sozinho). Não precisamos escrever `new Date()`.
    return this.gateways.save(current);
  }

  async remove(id: string): Promise<void> {
    // `delete` devolve um resumo da operação, incluindo quantas linhas foram
    // afetadas. Se nada foi afetado, o id não existia — e isso vira 404.
    // É uma informação que o `Map` da Fase 1 não nos dava.
    const result = await this.gateways.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Gateway ${id} não encontrado`);
    }
  }

  /**
   * Calcula quanto custaria passar uma transação por este gateway.
   *
   * É a peça central do projeto: o motor de roteamento vai chamar este cálculo
   * para CADA gateway ativo e escolher o de maior líquido esperado.
   *
   * Fórmula: taxa = parte fixa + (valor x percentual / 100)
   *
   * Por que `Math.round`? Porque dinheiro não tem meio centavo. Sem arredondar,
   * o resultado teria casas decimais infinitas em alguns percentuais e o erro
   * se acumularia ao longo de milhares de transações.
   */
  async estimateFee(id: string, amountInCents: number): Promise<FeeEstimate> {
    // Reaproveitamos findOne: se o gateway não existir, o 404 já vem de graça.
    const gateway = await this.findOne(id);

    // (valor x percentual) / 100 -> parte percentual, em centavos.
    const feePercentInCents = Math.round(
      (amountInCents * gateway.feePercent) / 100,
    );

    const totalFeeInCents = gateway.feeFixed + feePercentInCents;

    return {
      gatewayId: gateway.id,
      gatewayName: gateway.name,
      amountInCents,
      feeFixedInCents: gateway.feeFixed,
      feePercentInCents,
      totalFeeInCents,
      netAmountInCents: amountInCents - totalFeeInCents,
    };
  }
}
