import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/**
 * Módulo de saúde.
 *
 * Um "módulo" no NestJS é uma caixa que agrupa tudo que pertence à mesma
 * responsabilidade: controllers (rotas) e providers (serviços, repositórios...).
 * Depois esse módulo é importado no AppModule, e o Nest passa a conhecer as
 * rotas dele. Essa organização em módulos é o que mantém o projeto escalável.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
