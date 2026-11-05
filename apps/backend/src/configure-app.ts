import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { ACCESS_TOKEN_COOKIE } from './auth/auth.constants.js';

/**
 * Origens liberadas quando nada foi configurado, e estamos em desenvolvimento.
 *
 * São as portas em que o front roda localmente. Em produção esta lista é
 * ignorada de propósito (veja `resolveCors`), porque liberar localhost em
 * produção é hábito ruim que uma hora vira buraco.
 */
const LOCAL_DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
];

/**
 * Decide quem pode chamar a API pelo navegador.
 *
 * POR QUE ISSO NÃO É DETALHE.
 *
 * O front vai rodar em um domínio e a API em outro. Isso faz toda requisição
 * do navegador ser "cross-origin", e por padrão o navegador bloqueia. O CORS
 * é o servidor dizendo QUEM tem permissão de falar com ele.
 *
 * `credentials: true` é o que permite o cookie de sessão viajar. E ele não
 * pode ser combinado com `origin: '*'`: o próprio navegador recusa essa
 * dupla, porque significaria "qualquer site do mundo pode fazer requisições
 * autenticadas em nome do usuário". Por isso aqui SEMPRE trabalhamos com
 * lista explícita de origens.
 *
 * O PADRÃO É NEGAR. Sem `CORS_ORIGINS` em produção, nenhuma origem externa
 * passa — e o front para de funcionar na hora, o que é um erro barulhento e
 * fácil de corrigir. O contrário (liberar geral por padrão) seria um erro
 * silencioso e perigoso.
 */
function resolveCors() {
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const isProduction = process.env.NODE_ENV === 'production';

  const allowedOrigins =
    configuredOrigins.length > 0
      ? configuredOrigins
      : isProduction
        ? []
        : LOCAL_DEVELOPMENT_ORIGINS;

  return {
    // Lista vazia desliga o CORS por completo (nada de fora passa), que é o
    // comportamento seguro. A API continua atendendo quem chega de dentro.
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Expor o cabeçalho de replay deixa o front saber se a resposta veio do
    // cache de idempotência. Sem declarar aqui, o navegador esconde dele.
    exposedHeaders: ['X-Payment-Replayed'],
  };
}

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
 * divergirem. O mesmo vale para o CORS e para a leitura de cookies: se
 * ficassem só em produção, os testes autenticariam de um jeito que o
 * navegador não conseguiria.
 */
export function configureApp(app: INestApplication): void {
  // `trust proxy` faz o Express confiar no cabeçalho de origem que o proxy do
  // Render acrescenta.
  //
  // As duas razões são concretas:
  //
  //  1. Sem isso, `req.ip` enxerga o IP do PROXY, não o do visitante. Como o
  //     limite de tentativas de login é por IP, todo mundo passaria a dividir
  //     o mesmo contador — dez erros de senha de uma pessoa bloqueariam o
  //     login de todas as outras.
  //  2. A detecção de HTTPS (`req.secure`) passa a funcionar, o que importa
  //     para o cookie marcado como `secure`.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Sem esta linha, `req.cookies` não existe e o guard não enxerga a sessão
  // — era o elo que faltava entre o cookie gravado no login e a leitura dele
  // nas requisições seguintes.
  app.use(cookieParser());

  app.enableCors(resolveCors());

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

  const config = new DocumentBuilder()
    .setTitle('Payment Router & Dropshipping API')
    .setDescription(
      'API de Roteamento de Pagamentos com validação de estoque para Dropshipping Nacional. ' +
        'Inclui suporte a idempotência, transações atômicas e escolha inteligente de gateways. ' +
        'A maioria das rotas exige sessão: faça o login em POST /auth/login antes de testar.',
    )
    .setVersion('1.0')
    // Declara que a autenticação viaja em cookie. O navegador já envia o
    // cookie sozinho depois do login feito nesta mesma origem, então este
    // registro serve para a documentação dizer COMO a sessão viaja.
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .addTag('Auth', 'Login, renovação de sessão e perfil')
    .addTag('Payments', 'Operações de cobrança e histórico')
    .addTag('Gateways', 'Gerenciamento de provedores de pagamento')
    .addTag('Dashboard', 'Resumo e métricas da operação')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
}
