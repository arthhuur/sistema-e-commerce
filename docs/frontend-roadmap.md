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
| Organização do código | **Monorepo** no repositório atual |

Consequência direta da primeira decisão: **o front não pode começar antes do backend.** Login e dashboard dependem de coisas que a API ainda não tem. Por isso existe a Fase 0 abaixo.

---

## 3. Fase 0 — preparar o backend (obrigatório antes do front)

Hoje a API não tem o que a interface precisa para existir. Cada item abaixo é um bloqueio real, não uma melhoria estética.

### 3.1 Autenticação e perfis

- Entidade `User` (e-mail único, senha com hash, perfil, ativo)
- Hash de senha com `argon2` — nunca senha em texto no banco
- `POST /auth/login` devolvendo token (JWT) e `GET /auth/me`
- `JwtAuthGuard` protegendo as rotas existentes
- `RolesGuard` + decorator `@Roles(...)` para permissão por perfil
- Migration criando a tabela `users`
- **Segundo fator (2FA/TOTP)** completo, com códigos de recuperação (ver 3.6)

### 3.2 CORS

O front roda em domínio diferente da API. Sem `app.enableCors()` a requisição é bloqueada pelo navegador. Hoje **isso não existe** em `configure-app.ts`.

### 3.3 Endpoint de métricas do dashboard

O dashboard mostra números resumidos, e nenhum endpoint devolve isso hoje. Precisa de um `GET /dashboard/summary` calculando no servidor (não no front):

- total processado hoje / no período
- quantidade de pagamentos aprovados
- ticket médio
- taxa de aprovação
- pedidos sem estoque
- divergências de conciliação abertas

Cálculo fica no banco (`SUM`, `COUNT`, `AVG`). O front só exibe.

### 3.4 Paginação em `GET /payments`

Hoje `findAll()` devolve **todos** os pagamentos. Com mil registros a tela trava; com cem mil, derruba a API. É o gargalo mais concreto do projeto.

Correção: `?page=1&limit=20` (ou cursor), com filtro por status e período, e retorno no formato `{ data, total, page, limit }`.

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

---

## 5. Fase 1 — Login + Dashboard

A primeira entrega, escolhida por ser fundação em vez de vitrine.

### Tela de Login

- e-mail e senha, dois campos, um botão
- mensagem de erro clara ("e-mail ou senha incorretos" — sem dizer qual dos dois)
- **nada de token no cliente**: a sessão viaja em cookie `httpOnly` gravado pela API. O front não guarda token em `localStorage`/`sessionStorage` — isso reintroduziria o XSS que o backend evita
- **segunda etapa do 2FA**: se o login responder `{ mfaRequired: true }`, mostrar a tela do código e chamar `POST /auth/mfa/verify` (detalhes em 3.6)

### Tela de Dashboard

Nível 1 de informação. Quatro cartões, nada mais:

1. **Total processado hoje** — o número que o dono quer ver primeiro
2. **Vendas aprovadas** — quantidade
3. **Taxa de aprovação** — em porcentagem
4. **Pedidos sem estoque** — o alerta que pede ação

E uma lista curta abaixo: **5 últimos pagamentos**. Quem quiser mais clica e vai para o detalhe.

O que **não** entra: gráfico de 12 meses, filtro de 8 campos, comparativo anual, percentual de crescimento. Isso é nível 2, e só depois que os quatro números provarem que a tela faz sentido.

### Detalhe do pagamento

Clicou no item da lista, abre com o registro completo: valor, gateway escolhido, taxas, líquido, status, data.

---

## 6. Fases seguintes

| Fase | Conteúdo |
| --- | --- |
| 2 | Pagamentos: lista paginada, filtros, detalhe |
| 3 | Gateways: cadastro, edição, simulação de taxa |
| 4 | Produtos/Estoque: disponibilidade e vínculo com fornecedor |
| 5 | Conciliação: rodar, ver divergências, resolver |
| 6 | Usuários: o gerente administra os acessos |

Ordem escolhida do mais usado para o menos usado — não do mais fácil para o mais difícil.

---

## 7. Estrutura do monorepo

```
payment-router/
├── apps/
│   ├── backend/          # API NestJS atual, movida para cá
│   └── web/              # Next.js
├── packages/
│   └── shared/           # tipos e contratos usados pelos dois lados
└── docs/
```

`packages/shared` existe para resolver um problema específico: hoje o tipo `Payment` vive dentro do backend. Se o front redeclarar esse tipo à mão, um dia os dois vão discordar e o bug vai ser silencioso. Compartilhando, isso não acontece.

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
