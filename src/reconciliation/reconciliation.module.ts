import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';
import { PaymentsModule } from '../payments/payments.module.js';

/**
 * Módulo da conciliação.
 *
 * Depende do PaymentsModule para ler o livro caixa. Note que ele importa o
 * módulo inteiro e recebe só o que foi exportado — ou seja, o PaymentsService.
 * O IdempotencyService não está disponível aqui, e isso é intencional.
 */
@Module({
  imports: [PaymentsModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
