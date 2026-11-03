import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { GatewaysModule } from './gateways/gateways.module.js';
import { RoutingModule } from './routing/routing.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { AuthModule } from './auth/auth.module.js';
import { createObserveModule } from '@nestjs/observe';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  // Todo módulo de funcionalidade precisa ser declarado aqui para ganhar vida.
  imports: [
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY,
      appSecret: process.env.OBSERVE_APP_SECRET,
      serviceId: 'payment-router',
    }),
    // `isGlobal: true` deixa o ConfigService disponível em qualquer módulo sem
    // precisar importar o ConfigModule de novo em cada um deles.
    // Ele é quem LÊ o arquivo `.env` e joga os valores em `process.env`.
    ConfigModule.forRoot({ isGlobal: true }),
    // A conexão com o Postgres. Vem antes das features porque elas dependem
    // dela para registrar os seus repositórios (`forFeature`).
    DatabaseModule,
    // Autenticação vem logo depois do banco: além de registrar as rotas de
    // login, é este módulo que declara os guards GLOBAIS de sessão e perfil.
    AuthModule,
    HealthModule,
    GatewaysModule,
    RoutingModule,
    PaymentsModule,
    ReconciliationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
