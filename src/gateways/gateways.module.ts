import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewaysController } from './gateways.controller.js';
import { GatewaysService } from './gateways.service.js';
import { Gateway } from './gateway.entity.js';

/**
 * O "prédio" da feature de gateways.
 *
 * - imports:     o que este módulo precisa de outros (aqui, o repositório)
 * - controllers: as rotas (o garçom)
 * - providers:   as classes injetáveis (a cozinha)
 * - exports:     o que OUTROS módulos podem usar
 *
 * `TypeOrmModule.forFeature([Gateway])` é o que registra o repositório DESTA
 * entidade e o deixa disponível para injeção (`@InjectRepository(Gateway)`).
 * Repare que ele não abre conexão nenhuma: a conexão é uma só, aberta no
 * DatabaseModule. `forFeature` só cria o "balcão de atendimento" da tabela
 * dentro deste módulo.
 *
 * `exports: [GatewaysService]` é obrigatório para que o RoutingModule consiga
 * injetar este Service. Sem isso: "Nest can't resolve dependencies".
 * A analogia: a cozinha precisa estar disponível para o prédio vizinho.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Gateway])],
  controllers: [GatewaysController],
  providers: [GatewaysService],
  exports: [GatewaysService],
})
export class GatewaysModule {}
