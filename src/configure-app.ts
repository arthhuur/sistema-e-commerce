import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Configuração compartilhada da aplicação.
 *
 * Por que isto NÃO fica dentro do main.ts?
 *
 * Porque os testes E2E precisam subir EXATAMENTE a mesma aplicação que roda em
 * produção. Se o ValidationPipe ficasse só no main.ts, os testes E2E subiriam
 * uma app SEM o "porteiro" de validação — e passariam verdes validando nada.
 * É um dos erros mais comuns: a suíte E2E aprova um sistema que não existe.
 *
 * Extraindo para uma função usada pelos dois lados, é impossível eles
 * divergirem.
 */
export function configureApp(app: INestApplication): void {
  // ValidationPipe é o "porteiro" que confere as fichas de pedido (DTOs).
  // - whitelist: remove do corpo tudo que não está declarado no DTO.
  // - forbidNonWhitelisted: em vez de só remover, REJEITA com erro 400.
  //   Isso evita que alguém mande campos escondidos e confunda a aplicação.
  // - transform: converte o JSON cru nos tipos declarados (ex.: string -> Number).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Configuração do Swagger para documentação visual da API
  const config = new DocumentBuilder()
    .setTitle('Payment Router & Dropshipping API')
    .setDescription(
      'API de Roteamento de Pagamentos com validação de estoque para Dropshipping Nacional. ' +
        'Inclui suporte a idempotência, transações atômicas e escolha inteligente de gateways.',
    )
    .setVersion('1.0')
    .addTag('Payments', 'Operações de cobrança e histórico')
    .addTag('Gateways', 'Gerenciamento de provedores de pagamento')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
}
