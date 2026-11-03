import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';

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
  /**
   * PRECISA ser público, e não é escolha de estilo.
   *
   * Quem chama esta rota é o Render, e ele não faz login. Se ficasse
   * protegida, responderia 401, o Render entenderia como "container doente" e
   * reiniciaria a aplicação em laço — derrubando o sistema justamente pela
   * rota que existe para verificar se ele está de pé.
   *
   * O retorno também é deliberadamente vazio de informação: diz que está
   * vivo, e nada sobre o banco, versões ou configuração.
   */
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'payment-router',
      timestamp: new Date().toISOString(),
    };
  }
}
