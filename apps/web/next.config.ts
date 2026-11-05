import type { NextConfig } from "next";

/**
 * Para onde o front encaminha as chamadas de API.
 *
 * Em desenvolvimento é a própria máquina (a API sobe na porta 3000). Em
 * produção o Render entrega outra URL, e aí basta definir `BACKEND_URL` no
 * painel do serviço — sem tocar em código.
 *
 * Note o `??` no lugar de um `if`: existe SEMPRE um destino. A aplicação
 * nunca sobe com um alvo indefinido, o que transformaria um esquecimento de
 * variável em um erro obscuro lá na frente.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // O front importa TypeScript direto de `packages/shared`, que é um pacote
  // do próprio repositório ligado por symlink. Sem esta linha, o Next trata
  // o pacote como um `node_modules` comum (já compilado) e recusa o `.ts`.
  transpilePackages: ["@payment-router/shared"],

  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async rewrites() {
    return [
      {
        // POR QUE ISTO EXISTE.
        //
        // O navegador só conversa com o front. Quando ele pede
        // `/api/auth/login`, quem recebe é o Next, que repassa a chamada para
        // a API e devolve a resposta como se fosse dela mesma.
        //
        // O GANHO NÃO É ESTÉTICO. Como tudo sai do MESMO domínio, o cookie de
        // sessão `httpOnly` vira cookie "de primeira parte": o navegador o
        // aceita e o reenvia sem drama. Se o front falasse direto com a API em
        // outro domínio, o cookie seria de terceiros — que o Safari e o Chrome
        // bloqueiam por padrão — e o login simplesmente não "grudaria".
        //
        // O PREFIXO `/api` É RETIRADO do caminho. As rotas da API vivem na
        // raiz dela (`/auth/login`, `/payments`, `/dashboard/summary`); quem
        // mora em `/api` é a documentação Swagger. Sem a retirada, uma chamada
        // a `/api/auth/login` procuraria `/api/auth/login` do outro lado, que
        // não existe.
        //
        // O EFEITO COLATERAL É CONHECIDO E ACEITO: o front não pode publicar
        // rotas próprias sob `/api`, porque elas são todas encaminhadas. O
        // Swagger continua acessível direto no domínio da API.
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
