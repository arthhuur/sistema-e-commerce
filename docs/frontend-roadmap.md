# Frontend Roadmap

Este documento descreve a próxima evolução do projeto: transformar a API atual em um sistema utilizável por uma pessoa comum, com interface visual e fluxo operacional claro.

## Objetivo

Criar uma interface web para que o usuário consiga:

- acompanhar pagamentos e pedidos
- ver qual gateway foi escolhido
- identificar pedidos sem estoque
- acompanhar conciliação e divergências
- operar o sistema sem precisar conhecer Swagger ou endpoints

## Estrutura Planejada

- `apps/backend`: backend NestJS existente
- `apps/web`: frontend web
- `packages/shared`: contratos, tipos e componentes compartilháveis

## Telas Iniciais

1. Dashboard
2. Gateways
3. Pagamentos
4. Conciliação
5. Detalhe de pedido/pagamento

## Métricas Visuais

- pagamentos aprovados
- valor total processado
- taxa média de aprovação
- pedidos sem estoque
- divergências de conciliação

## Meta da Próxima Versão

Registrar a evolução do projeto saindo de uma base técnica de backend para uma aplicação completa, com experiência de uso adequada para operação real e apresentação a recrutadores.
