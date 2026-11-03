import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  // A configuração vive em configure-app.ts para ser compartilhada com os
  // testes E2E — assim a app dos testes é idêntica à de produção.
  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
