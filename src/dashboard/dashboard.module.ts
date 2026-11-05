import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../payments/payment.entity.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Módulo do dashboard.
 *
 * `TypeOrmModule.forFeature([Payment])` registra o repositório do livro caixa
 * para este módulo. Repare que NÃO importamos o `PaymentsModule`: o dashboard
 * não pede ao serviço de pagamentos, ele consulta a MESMA tabela por conta
 * própria, com `SUM`/`COUNT`. Importar o PaymentsModule aqui também funcionaria,
 * mas criaria um acoplamento sem uso — o dashboard não chama `create()` nem
 * `findPage()`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
