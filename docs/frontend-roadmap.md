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
- token guardado de forma segura no cliente

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
