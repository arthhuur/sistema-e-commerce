import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { SuppliersService } from './suppliers.service.js';
import { Payment } from './payment.entity.js';
import { IdempotencyRecord } from './idempotency-record.js';
import { RoutingModule } from '../routing/routing.module.js';

/**
 * Módulo de pagamentos.
 *
 * - `imports: [RoutingModule]` só funciona porque o RoutingModule lista
 *   `exports: [RoutingService]`. É sempre o par: quem EXPORTA e quem IMPORTA.
 * - `TypeOrmModule.forFeature([...])` registra os DOIS repositórios usados
 *   aqui: a tabela `payments` (livro caixa) e `idempotency_records` (o caderno
 *   de etiquetas). Sem esta linha, o `@InjectRepository` de dentro dos
 *   Services não teria o que injetar.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, IdempotencyRecord]), RoutingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, IdempotencyService, SuppliersService],
  // Exportamos só o PaymentsService: a conciliação precisa ler o livro caixa.
  // O IdempotencyService fica PRIVADO de propósito — ninguém de fora deve
  // mexer no caderno de etiquetas. Expor o mínimo é princípio de bom design.
  exports: [PaymentsService],
})
export class PaymentsModule {}
