# Frontend Roadmap

Este documento descreve a próxima evolução do projeto: transformar a API atual em um sistema que uma pessoa comum consiga usar, sem precisar conhecer Swagger, endpoints ou termos técnicos.

---

## 1. Ideia central

O sistema precisa **parecer simples para quem usa**. Pouca informação por tela, uma decisão por tela, e o detalhe escondido atrás de um clique.

A regra prática adotada:

> **Uma pergunta por tela.**

- "Quanto vendi hoje?" → Dashboard
- "Qual pedido deu problema?" → Pagamentos
- "Meu produto tem estoque?" → Estoque

Nunca as duas perguntas juntas. É isso que impede a tela de assustar.

### Os três níveis de informação

| Nível | Onde | Para quem |
| --- | --- | --- |
| 1. Resumo | Tela principal, 4 números e uma ação | Qualquer usuário |
| 2. Detalhe | Clique no item, vê tudo daquele registro | Operação |
| 3. Técnico | Swagger (`/api`), continua existindo | Desenvolvedor |

O nível 3 não some. Ele só sai da frente.

---

## 2. Decisões já tomadas

| Decisão | Escolha |
| --- | --- |
| Autenticação | **Própria, dentro do NestJS** (tabela de usuários, hash de senha, JWT e guards) |
| Segundo fator | **TOTP (2FA) opcional por conta**, com códigos de recuperação — já implementado |
| Primeira entrega | **Login + Dashboard** |
| Tecnologia do front | **Next.js**, publicado na **Vercel** |
| Organização do código | **Monorepo** no repositório atual — backend já em `apps/backend` |

Consequência direta da primeira decisão: **o front não pode começar antes do backend.** Login e dashboard dependem de coisas que a API ainda não tem. Por isso existe a Fase 0 abaixo.

---

## 3. Fase 0 — preparar o backend (obrigatório antes do front)

A API precisava de coisas que a interface exige e que ainda não existiam. Cada item abaixo era um bloqueio real, não uma melhoria estética.

**Situação: 3.1, 3.2, 3.3, 3.4 e 3.6 concluídos.** Falta só o 3.5 (estoque), que é modelagem para uma fase futura. O backend já tem tudo o que a Fase 1 (Login + Dashboard) consome.

### 3.1 Autenticação e perfis (concluído)

- Entidade `User` (e-mail único, senha com hash, perfil, ativo)
- Hash de senha com `argon2` — nunca senha em texto no banco
- `POST /auth/login` devolvendo token (JWT) e `GET /auth/me`
- `JwtAuthGuard` protegendo as rotas existentes
- `RolesGuard` + decorator `@Roles(...)` para permissão por perfil
- Migration criando a tabela `users`
- **Segundo fator (2FA/TOTP)** completo, com códigos de recuperação (ver 3.6)

### 3.2 CORS (concluído)

O front roda em domínio diferente da API, então toda requisição é "cross-origin" e o navegador bloqueia por padrão. Quem resolve isso é o servidor, em `resolveCors()`, no `configure-app.ts`:

- As origens liberadas vêm de `CORS_ORIGINS` (lista separada por vírgula).
- Em desenvolvimento, sem `CORS_ORIGINS`, vale uma lista de portas locais (`localhost:3000`, `localhost:3001`).
- Em produção, sem `CORS_ORIGINS`, **nenhuma** origem externa passa — o padrão é negar.
- `credentials: true` é o que deixa o cookie de sessão viajar; por isso nunca se usa `origin: '*'` (o navegador recusa essa combinação sozinho).

### 3.3 Endpoint de métricas do dashboard (concluído)

O dashboard mostra números resumidos, e nenhum endpoint devolvia isso. Agora existe o `GET /dashboard/summary`, que calcula no servidor (agregação no banco, com `COUNT`/`SUM`) e devolve:

| Campo | Significado |
| --- | --- |
| `paymentCount` | Quantidade de pagamentos aprovados no período |
| `totalProcessedInCents` | Soma cobrada dos clientes (centavos) |
| `averageTicketInCents` | Ticket médio do período (centavos) |
| `netReceivedInCents` | Quanto sobrou para o lojista, após as taxas (centavos) |
| `totalFeesInCents` | Total pago em taxas aos gateways (centavos) |
| `periodStart` / `periodEnd` | O período considerado, em ISO 8601 |

Aceita `?from=` e `?to=` (sem eles, o período é o dia de hoje). O acesso é restrito a **gerente** e **financeiro**: é número financeiro, e "ver ou não ver" é decidido no backend — não escondendo um cartão no front.

**Dois cartões do rascunho ficaram de fora, de propósito.** Os dados para preenchê-los ainda não existem:

- **Taxa de aprovação** — todo pagamento nasce e morre `approved` (a cobrança ainda é simulada). A taxa seria sempre 100%: um número inventado com cara de informação.
- **Pedidos sem estoque** — o pedido sem estoque é recusado com 422 e **não é gravado**. Não existe linha para contar.

Os dois voltam quando o pagamento tiver status reais (Fase 2) e quando o estoque virar uma entidade de verdade (Fase 4, item 3.5).

### 3.4 Paginação em `GET /payments` (concluído)

Antes, `findAll()` devolvia **todos** os pagamentos: com mil registros a tela travaria; com cem mil, derrubaria a API. Era o gargalo mais concreto do projeto.

Agora existe uma página:

- `?page=1&limit=20` — padrão 1 e 20, com teto de 100 no `limit`.
- Filtros por `status`, `from` e `to` (uma data sem hora conta o dia **inteiro**).
- Retorno no formato `{ data, total, page, limit }`, do mais recente para o mais antigo.

`findAll()` continua existindo porque a conciliação precisa da lista inteira. Quem serve a tela é o novo `findPage()`.

### 3.5 Entidade Produto/Estoque (para a fase de estoque)

O `SuppliersService` atual é uma simulação que verifica se o texto do ID contém `out-of-stock`. Para o usuário "ver estoque", precisa existir um registro real de produto com disponibilidade e vínculo com o fornecedor.

Fica para depois da Fase 1, mas nasce aqui como decisão de modelagem.

### 3.6 Segundo fator (2FA) — pronto, e o contrato para o front

O 2FA já está implementado no backend e coberto por testes E2E. O front **não pode ignorá-lo**: quando a conta tem o segundo fator ativo, o login deixa de abrir sessão na primeira chamada.

**Como o front deve tratar o login em duas etapas:**

1. `POST /auth/login` com `{ email, password }`.
2. A resposta pode ser **dois casos** (o front precisa distinguir pelo corpo):
   - sessão aberta → corpo com `id`, `email`, `role` (cookies de sessão já gravados);
   - falta o segundo fator → corpo `{ mfaRequired: true }` e um cookie temporário. **Nenhum cookie de sessão é gravado.** O front mostra a tela do código.
3. Se `mfaRequired` for `true`, o front chama `POST /auth/mfa/verify` com `{ code }` (o cookie temporário vai junto automaticamente). A sessão só abre aqui.

**Endpoints do 2FA:**

| Método | Rota | Quem usa | O que faz |
| --- | --- | --- | --- |
| `POST` | `/auth/mfa/setup` | Configuração (logado) | Gera o segredo e devolve `{ otpauthUrl, qrDataUrl }`. O QR é uma **data URL** pronta para um `<img src>` |
| `POST` | `/auth/mfa/activate` | Configuração (logado) | Confere um código e liga o 2FA. Devolve `{ recoveryCodes }` — **uma única vez** |
| `GET` | `/auth/mfa` | Configuração (logado) | `{ enabled, pending }` — decide entre "ativar" e "desativar" |
| `POST` | `/auth/mfa/disable` | Configuração (logado) | Desliga o 2FA. Exige um código válido (sessão roubada não remove o fator) |
| `POST` | `/auth/mfa/verify` | Login (público) | Segunda etapa: confere o código e abre a sessão |

**Decisões que o front herda e não deve desfazer:**

- Os tokens **nunca** aparecem no corpo da resposta — só em cookies `httpOnly`. O front não guarda token em `localStorage` (isso reintroduziria o XSS que o backend evita).
- A configuração do 2FA é **em dois tempos**: `setup` gera o QR, `activate` confirma com um código. O front precisa das duas telas (mostrar o QR → pedir o código → mostrar os códigos de recuperação).
- O QR é `otpauth://` — funciona em Google Authenticator, Microsoft Authenticator, Authy e afins.
- Os **códigos de recuperação** aparecem uma vez só. A tela precisa avisar isso e oferecer "copiar"/"baixar".

---

## 4. Perfis e permissões (proposta)

| Perfil | Vê | Pode fazer | Não pode |
| --- | --- | --- | --- |
| **Gerente** | Tudo | Gerenciar gateways, usuários, ver conciliação e financeiro | — |
| **Vendedor** | Seus pedidos | Criar venda/pedido, acompanhar status | Tocar em gateway ou usuários |
| **Estoque** | Produtos e pedidos pendentes | Atualizar disponibilidade, confirmar com fornecedor | Ver taxas, lucro e conciliação |
| **Financeiro** *(opcional, fase futura)* | Conciliação e taxas | Resolver divergências | Criar pedidos |

O backend é a fonte da verdade. O front só **esconde** o que o usuário não deve ver — quem bloqueia de fato é o `RolesGuard`. Esconder no front sem proteger no back é o erro clássico e mais perigoso.

Exemplo já em vigor: o `GET /dashboard/summary` responde **403** para vendedor e estoque, mesmo que alguém chame a API direto, sem passar pela tela.

---

## 5. Fase 1 — Login + Dashboard

A primeira entrega, escolhida por ser fundação em vez de vitrine.

**Situação: a Fase 1 está concluída, a tela de Pagamentos também, e a Fase 3 já começou.** A tela de Login (com a segunda etapa do 2FA e o logout), o Dashboard, o extrato de pagamentos e o primeiro bloco de Gateways (leitura + simulação de taxa) estão prontos, junto da guarda de rotas e do proxy da API. O próximo passo é fechar a Fase 3 com cadastro, edição e exclusão.

### Tela de Login (concluída)

- e-mail e senha, dois campos, um botão
- mensagem de erro clara ("e-mail ou senha incorretos" — sem dizer qual dos dois)
- **nada de token no cliente**: a sessão viaja em cookie `httpOnly` gravado pela API. O front não guarda token em `localStorage`/`sessionStorage` — isso reintroduziria o XSS que o backend evita
- **segunda etapa do 2FA**: se o login responder `{ mfaRequired: true }`, mostrar a tela do código e chamar `POST /auth/mfa/verify` (detalhes em 3.6)
- **sessão que não cai sozinha**: ao receber `401` de uma rota de dado, o front troca o cookie de renovação por um par novo e repete a chamada. Sem isso, a tela quebraria a cada 15 minutos, apesar de a sessão estar viva
- passa pelo proxy `/api` do `next.config.ts`, então o cookie é de primeira parte e não há CORS envolvido

### Tela de Dashboard (concluída)

Nível 1 de informação. **Quatro cartões, nada mais** — o número grande é a resposta, o resto é contexto:

1. **Total processado hoje** — o número que o dono quer ver primeiro
2. **Vendas aprovadas** — quantidade
3. **Ticket médio**
4. **Líquido recebido** — com as taxas do período como legenda logo abaixo ("após R$ X em taxas")

E uma lista curta abaixo: **5 últimos pagamentos**. Quem quiser mais clica e vai para o detalhe.

Todos os números vêm prontos do `GET /dashboard/summary` (item 3.3): a tela não soma nada, só exibe. Os cartões de **taxa de aprovação** e **pedidos sem estoque** do rascunho saíram por falta de dado real — voltam nas Fases 2 e 4.

O que **não** entra: gráfico de 12 meses, filtro de 8 campos, comparativo anual, percentual de crescimento. Isso é nível 2, e só depois que os quatro números provarem que a tela faz sentido.

**Como foi feito:** a tela dispara as três chamadas (`/auth/me`, `/dashboard/summary` e `/payments?limit=5`) **em paralelo**, com `Promise.allSettled` — uma falha isolada não derruba as outras. O resumo é restrito aos perfis gerente e financeiro; quando a API responde **403**, a tela não mostra uma falha (o que faria parecer que o sistema quebrou): explica que aqueles números são daqueles perfis. Enquanto a identidade não chega, nenhum número é desenhado — um "R$ 0,00" provisório seria lido como "não vendi nada", que é falso.

### Tela de Pagamentos (concluída)

O extrato da operação: muitas linhas, do mais recente para o mais antigo, com página, filtro de período e o detalhe atrás de um clique.

**Como foi feito:**

- **O estado mora na URL** (`?page=2&from=2026-11-01&to=2026-11-05`), não em memória. Assim o F5 mantém a pessoa onde ela estava, o "voltar" do navegador funciona como se espera, e o link pode ser compartilhado já filtrado. Guardado em `useState`, tudo isso se perde no primeiro recarregamento — e o usuário culpa a tela.
- **Filtro só de período.** O `status` ficou de fora de propósito: hoje só existe `approved`, e um seletor com uma única opção é um controle que não decide nada. Ele entra quando `PAYMENT_STATUSES` ganhar o segundo valor — o `packages/shared` já carrega a lista em tempo de execução.
- **Detalhe sem tela nova.** Todos os campos do registro (valor, taxas, líquido, status, gateway, data) já vêm na própria listagem, então o clique abre a linha em vez de navegar: sem endpoint novo, sem consulta extra. O que fica de fora é apenas o link direto para um pagamento específico; quando isso for necessário, o caminho é `GET /payments/:id` na API — o contrato muda primeiro.
- **Carga "chaveada".** Cada resposta é amarrada à consulta que a pediu, e a busca anterior é cancelada (`AbortController`). Sem isso, trocar o filtro duas vezes rápido deixaria a resposta VELHA chegar depois da nova e sobrescrevê-la — a tela mostraria o resultado do filtro anterior, um bug que não se reproduz testando devagar.
- **`/pagamentos` entrou na guarda.** Os prefixos protegidos viraram uma lista (`PROTECTED_PREFIXES`, no `proxy.ts`), para a próxima tela não depender de alguém lembrar de duplicar a condição.

### Tela de Gateways (leitura + simulação concluídas)

A entrada da Fase 3 foi feita pelo caminho mais seguro: primeiro ver e comparar, depois editar. A tela `/gateways` lista os gateways já cadastrados, abre o detalhe inline e traz um simulador de taxa por linha.

**Como foi feito:**

- **Leitura primeiro.** Antes de abrir formulário para mexer em credencial, a tela resolve a pergunta operacional mais frequente: "quanto custa passar esta venda por aqui?". Por isso ela começou com `GET /gateways` e `GET /gateways/:id/estimate`.
- **Detalhe sem sair da lista.** Taxa percentual, taxa fixa e aprovação observada abrem no clique da linha, junto do simulador. Isso mantém comparação lado a lado sem empurrar a pessoa para uma tela separada.
- **Simulação com conta no servidor.** O valor digitado em reais vira centavos e segue para a API; quem calcula é o backend. A tela só formata o retorno (`feeFixedInCents`, `feePercentInCents`, `totalFeeInCents`, `netAmountInCents`). Refazer a conta no front daria um número que o servidor não confirma.
- **Contrato compartilhado atualizado.** `Gateway` e `GatewayFeeEstimate` entraram em `packages/shared`, para a interface ler o mesmo formato que a API devolve.
- **`/gateways` entrou na guarda.** A lista de prefixos protegidos no `proxy.ts` cresceu de novo, e o cabeçalho do painel ganhou navegação para `Pagamentos` e `Gateways`, para a tela nova existir com caminho claro.

---

## 6. Fases seguintes

| Fase | Conteúdo |
| --- | --- |
| 2 | Pagamentos: lista paginada, filtros, detalhe |
| 3 | Gateways: leitura, simulação, cadastro, edição e exclusão |
| 4 | Produtos/Estoque: disponibilidade e vínculo com fornecedor |
| 5 | Conciliação: rodar, ver divergências, resolver |
| 6 | Usuários: o gerente administra os acessos |

Ordem escolhida do mais usado para o menos usado — não do mais fácil para o mais difícil.

---

## 7. Estrutura do monorepo

O repositório passou a ser um **monorepo com npm workspaces**. A raiz deixou de ter código de aplicação: ela só orquestra os apps.

```
payment-router/
├── apps/
│   ├── backend/          # API NestJS
│   └── web/              # Next.js (App Router + Tailwind)
├── packages/
│   └── shared/           # tipos e contratos usados pelos dois lados
├── docs/
├── package.json          # workspaces + scripts que delegam para os apps
└── Dockerfile            # build a partir da raiz
```

**Situação: a estrutura está montada.** A API vive em `apps/backend`, a interface em `apps/web` e os contratos em `packages/shared`. A API compila, passa no lint e nas suítes unit e E2E rodando a partir da raiz; a interface passa no lint e no build.

### Como a interface fala com a API

O navegador **só conversa com o front**. O `next.config.ts` reescreve tudo o que chega em `/api/...` para a API, retirando o prefixo no caminho:

```txt
navegador -> /api/auth/login  --(rewrite do Next)-->  API: /auth/login
```

Isso resolve, de uma vez, três problemas que apareceriam se o front chamasse a API direto em outro domínio:

1. O cookie de sessão passa a ser **de primeira parte** — o Safari e o Chrome o bloqueiam quando é de terceiros, e o login não "grudaria".
2. **Não é preciso CORS** em produção para a interface.
3. **Não é preciso `COOKIE_SAME_SITE=none`** — o padrão `lax`, mais seguro, dá conta.

O destino vem de `BACKEND_URL` (veja `apps/web/.env.example`): local aponta para `http://localhost:3000` e, em produção, para a URL pública da API.

**O que o front NÃO faz:** guardar token. A sessão existe apenas como cookie `httpOnly`; nenhum token toca `localStorage`, `sessionStorage` ou estado do React.

A proteção de rotas é feita em **duas camadas**, e a divisão importa:

- `apps/web/src/proxy.ts` faz a **checagem otimista** — olha se existe o cookie e desvia a navegação para a tela certa. É rápido de propósito: validar de verdade a cada navegação custaria uma espera visível em toda troca de tela.
- Cada rota da **API** confere a sessão por conta própria. É ela quem autoriza de fato. Passar pela guarda do front sem uma sessão válida não abre nada.

### Como a raiz funciona

Os scripts da raiz **delegam** para o workspace do backend, então os comandos continuam sendo executados da raiz:

```bash
npm run build    # -> npm run build --workspace apps/backend
npm run test     # -> vitest dentro de apps/backend
npm run start:dev # -> nest start dentro de apps/backend
```

Duas consequências práticas:

1. **O deploy do Render não precisou mudar.** A configuração continua apontando para a raiz, e a raiz chama o backend. Nada no painel foi alterado.
2. **As dependências são instaladas uma vez só.** O npm "iça" tudo para um `node_modules` na raiz (hoisting de workspaces), então não existe uma cópia por app.

### Por que `packages/shared`

Ele existe para resolver um problema específico: hoje o tipo `Payment` vive dentro do backend. Se o front redeclarar esse tipo à mão, um dia os dois vão discordar e o bug vai ser silencioso. Compartilhando o mesmo pacote, isso não acontece.

---

## 8. Alinhamento front ↔ back (o "sem gargalo")

Três acordos que evitam retrabalho:

1. **O contrato é o Swagger.** O front não inventa campos. Se precisa de um dado novo, o endpoint muda primeiro.
2. **Agregação no servidor.** Tela não soma lista para mostrar número. Se precisa de total, o banco calcula.
3. **Erro é resposta, não exceção de tela.** A API já devolve 400/409/422 com significado. O front traduz para linguagem humana e segue, sem "erro inesperado":

| API devolve | Usuário lê |
| --- | --- |
| 422 sem estoque | "Este produto está indisponível no fornecedor." |
| 409 chave em uso | "Este pedido já está sendo processado." |
| 400 sem chave | *(não acontece: o front gera a chave sempre)* |
| 503 sem gateway | "Nenhum meio de pagamento disponível agora." |

---

## 9. Acessibilidade e dispositivos

O sistema precisa abrir em qualquer aparelho — inclusive o celular do dono da loja às 23h.

- layout responsivo de verdade (mobile primeiro nas telas de leitura)
- contraste adequado e área de toque confortável
- textos em português claro, sem jargão técnico na interface
- carregamento com esqueleto/placeholder em vez de tela branca

Publicado na Vercel, com URL pública acessível de qualquer lugar, sem depender de máquina ligada.

---

## 10. Meta desta fase

Registrar a evolução do projeto saindo de uma base técnica de backend para uma aplicação completa: com autenticação, perfil de acesso, visão gerencial e experiência de uso adequada para operação real — e apresentável a qualquer pessoa que abrir o link.
