import { Module } from '@nestjs/common';
import { RoutingController } from './routing.controller.js';
import { RoutingService } from './routing.service.js';
import { GatewaysModule } from '../gateways/gateways.module.js';

/**
 * Módulo do motor de roteamento.
 *
 * `imports: [GatewaysModule]` é o que dá ao RoutingService o direito de receber
 * um GatewaysService injetado. Sem isso, o Nest lança erro em tempo de
 * inicialização ("Nest can't resolve dependencies of RoutingService").
 * Regra: para usar um provider de outro módulo, o módulo de origem precisa
 * listá-lo em `exports` e o consumidor em `imports`.
 */
@Module({
  imports: [GatewaysModule],
  controllers: [RoutingController],
  providers: [RoutingService],
  // Tornamos o RoutingService público para outros módulos. Hoje quem consome é
  // o PaymentsModule; sem este `exports`, o Nest falharia ao criar o
  // PaymentsService com "can't resolve dependencies of PaymentsService".
  exports: [RoutingService],
})
export class RoutingModule {}
