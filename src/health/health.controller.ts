import { Controller, Get } from '@nestjs/common';

/**
 * Health check: endpoint que responde "a API está viva?".
 *
 * Por que isso importa na prática?
 * - Orquestradores (Docker, Kubernetes, Railway, Render) chamam esse endereço
 *   para decidir se o container está saudável e pode receber tráfego.
 * - É o primeiro endpoint que um recrutador vai testar ao abrir seu projeto.
 *
 * Aqui não existe regra de negócio, por isso não há um Service:
 * o Controller apenas devolve um payload fixo.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'payment-router',
      timestamp: new Date().toISOString(),
    };
  }
}
